"""Judge — quality evaluation, doom-loop detection, and stall monitoring for agent outputs.

The Judge runs as a lightweight quality gate after each agent produces output.
Three evaluation levels:
  Level 0 (Implicit): checks if output keys are filled, basic heuristics
  Level 1 (LLM): uses a small model to evaluate output vs success criteria
  Level 2 (Heuristic): detects doom loops (repeated actions), stalls, excessive retries

Integration with SwarmOrchestrator._run_single_agent:
  After the agent produces final_output, the Judge is called to assess quality.
  Verdict: ACCEPT (keep result), RETRY (inject feedback and re-run), or REJECT (mark failed).
"""

import logging
from dataclasses import dataclass, field
from enum import Enum

from agent_swarm.models import SubtaskResult

logger = logging.getLogger(__name__)


class JudgeVerdict(str, Enum):
    ACCEPT = "accept"
    RETRY = "retry"
    REJECT = "reject"


@dataclass
class JudgeEvaluation:
    verdict: JudgeVerdict
    score: float = 1.0  # 0.0–1.0 quality score
    feedback: str = ""
    concerns: list[str] = field(default_factory=list)


# ── Doom Loop & Stall Detection ──

@dataclass
class StallDetector:
    """Tracks per-agent execution health to detect degradation patterns."""

    MAX_ACTION_HISTORY = 10  # keep last N tool call names
    DOOM_LOOP_THRESHOLD = 4  # same action N times in window → doom loop
    STALL_TOKENS_THRESHOLD = 50  # output < N chars for 3+ consecutive iterations → stall
    MAX_RETRY_BEFORE_REJECT = 3  # more than N retries on same subtask → reject

    recent_actions: list[str] = field(default_factory=list)
    recent_output_lengths: list[int] = field(default_factory=list)
    stall_streak: int = 0

    def record_action(self, tool_name: str):
        self.recent_actions.append(tool_name)
        if len(self.recent_actions) > self.MAX_ACTION_HISTORY:
            self.recent_actions = self.recent_actions[-self.MAX_ACTION_HISTORY:]

    def record_output(self, output: str):
        output_len = len(output.strip()) if output else 0
        self.recent_output_lengths.append(output_len)
        if len(self.recent_output_lengths) > 5:
            self.recent_output_lengths = self.recent_output_lengths[-5:]

    def check_doom_loop(self) -> str:
        """Detect if the agent is stuck repeating the same action. Returns empty string if healthy."""
        if len(self.recent_actions) < self.DOOM_LOOP_THRESHOLD:
            return ""
        # Count the most frequent action in recent window
        window = self.recent_actions[-self.DOOM_LOOP_THRESHOLD:]
        most_common = max(set(window), key=window.count)
        if window.count(most_common) >= self.DOOM_LOOP_THRESHOLD:
            return (
                f"Doom loop detected: '{most_common}' called {window.count(most_common)} "
                f"times in the last {len(window)} tool calls. Try a fundamentally different approach."
            )
        return ""

    def check_stall(self) -> str:
        """Detect if the agent is producing near-empty output repeatedly. Returns empty string if healthy."""
        if len(self.recent_output_lengths) < 3:
            return ""
        recent = self.recent_output_lengths[-3:]
        if all(r < self.STALL_TOKENS_THRESHOLD for r in recent):
            self.stall_streak += 1
            if self.stall_streak >= 2:
                return (
                    f"Agent appears stalled: last {len(recent)} outputs average "
                    f"{sum(recent) // max(len(recent), 1)} chars. "
                    "Provide actionable output or change strategy."
                )
        else:
            self.stall_streak = 0
        return ""

    def check_retry_limit(self, retry_count: int) -> str:
        if retry_count >= self.MAX_RETRY_BEFORE_REJECT:
            return (
                f"Exceeded max retry limit ({self.MAX_RETRY_BEFORE_REJECT}). "
                "Marking as failed to avoid wasted tokens."
            )
        return ""


# ── Judge ──

QUALITY_JUDGE_SYSTEM_PROMPT = """You are a quality judge for AI agent outputs.
Your job is to evaluate whether an agent's output meets its assigned task requirements.

Evaluation rubric:
1. RELEVANCE: Does the output directly address the task prompt?
2. COMPLETENESS: Are the required elements present (data, analysis, code, etc.)?
3. QUALITY: Is the output substantive (not placeholder text, vague statements, or "unable to find" without trying)?
4. ACTIONABLE: Can the downstream agent or user act on this output?

Score 0.0–1.0:
- 0.8–1.0: Excellent — complete, well-structured, specific
- 0.5–0.8: Adequate — mostly complete, some gaps
- 0.3–0.5: Insufficient — major gaps, vague, or low-effort
- 0.0–0.3: Unacceptable — off-topic, empty, or harmful

Verdict:
- accept: score >= 0.7
- retry: 0.3 <= score < 0.7 — provide specific feedback on what to fix
- reject: score < 0.3 or completely irrelevant

Output MUST be valid JSON:
{"verdict": "accept"|"retry"|"reject", "score": float, "feedback": "specific actionable feedback", "concerns": ["concern1", "concern2"]}
"""


async def judge_output(
    llm_call,
    task_prompt: str,
    output: str,
    agent_role: str = "",
    judge_model: str = "qwen3:3b",
) -> JudgeEvaluation:
    """Evaluate agent output quality using a small LLM.

    Args:
        llm_call: async callable (model, messages, temperature) -> ChatCompletionMessage
        task_prompt: the original subtask prompt
        output: the agent's final output text
        agent_role: the agent's role (e.g. 'web_searcher', 'data_analyst')
        judge_model: lightweight model for judging (default qwen3:3b)
    """
    if not output or len(output.strip()) < 20:
        return JudgeEvaluation(
            verdict=JudgeVerdict.REJECT,
            score=0.0,
            feedback="Output is empty or too short to be useful.",
            concerns=["empty_output"],
        )

    try:
        user_prompt = (
            f"## Task assigned to the agent ({agent_role}):\n{task_prompt}\n\n"
            f"## Agent output to evaluate:\n{output[:4000]}\n\n"
            "Evaluate this output. Respond with JSON only."
        )
        msg = await llm_call(
            judge_model,
            [
                {"role": "system", "content": QUALITY_JUDGE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
        )
        raw = (msg.content or "").strip()

        # Parse JSON — handle markdown code fences
        import re, json
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", raw)
            if match:
                data = json.loads(match.group(0))
            else:
                raise ValueError(f"Judge returned invalid JSON: {raw[:200]}")

        verdict_str = data.get("verdict", "accept")
        verdict = JudgeVerdict(verdict_str) if verdict_str in ("accept", "retry", "reject") else JudgeVerdict.ACCEPT
        return JudgeEvaluation(
            verdict=verdict,
            score=float(data.get("score", 0.7)),
            feedback=data.get("feedback", ""),
            concerns=data.get("concerns", []),
        )
    except Exception as e:
        logger.warning(f"Judge LLM call failed, falling back to heuristic: {e}")
        return JudgeEvaluation(
            verdict=JudgeVerdict.ACCEPT,
            score=0.7,
            feedback=f"(Judge unavailable — auto-accepted: {e})",
        )


def judge_output_heuristic(
    output: str,
    task_prompt: str = "",
    retry_count: int = 0,
    stall_detector: StallDetector | None = None,
) -> JudgeEvaluation:
    """Fast heuristic-only quality check (no LLM call).

    Checks for common low-quality signals and doom-loop/stall patterns.
    """
    concerns: list[str] = []
    low_quality_signals = [
        "data insufficient", "no data found", "information insufficient",
        "not found", "no results", "数据不足", "未找到", "信息不足",
        "i apologize", "i'm sorry", "unable to", "cannot provide",
        "i don't have", "i cannot", "beyond my", "超出范围",
    ]
    output_lower = output.lower() if output else ""

    # Check for low-quality signals
    found_signals = [s for s in low_quality_signals if s in output_lower]
    if found_signals:
        concerns.append(f"Low-quality signals: {found_signals}")

    # Check output length
    if len(output.strip()) < 100:
        concerns.append(f"Output too short ({len(output.strip())} chars)")

    # Check doom loop via stall detector
    doom_msg = ""
    stall_msg = ""
    retry_msg = ""
    if stall_detector:
        doom_msg = stall_detector.check_doom_loop()
        stall_msg = stall_detector.check_stall()
        retry_msg = stall_detector.check_retry_limit(retry_count)

    if doom_msg:
        concerns.append(doom_msg)
    if stall_msg:
        concerns.append(stall_msg)

    # Determine verdict
    if retry_msg or (doom_msg and stall_msg):
        return JudgeEvaluation(
            verdict=JudgeVerdict.REJECT,
            score=0.1,
            feedback="; ".join(concerns + [retry_msg, doom_msg, stall_msg]) if (retry_msg or doom_msg) else "; ".join(concerns),
            concerns=concerns + ([retry_msg] if retry_msg else []) + ([doom_msg] if doom_msg else []) + ([stall_msg] if stall_msg else []),
        )

    if concerns:
        score = max(0.3, 1.0 - len(concerns) * 0.2)
        verdict = JudgeVerdict.RETRY if score < 0.7 else JudgeVerdict.ACCEPT
        return JudgeEvaluation(
            verdict=verdict,
            score=score,
            feedback="; ".join(concerns),
            concerns=concerns,
        )

    return JudgeEvaluation(verdict=JudgeVerdict.ACCEPT, score=0.85)
