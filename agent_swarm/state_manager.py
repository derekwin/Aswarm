"""状态管理与 Checkpoint - 任务状态追踪、子任务结果记录、断点续跑。"""

import json
import os
from datetime import datetime
from agent_swarm.models import TaskDAG, SwarmState, SubtaskResult


class StateManager:
    """管理 Swarm 任务的完整生命周期状态。

    职责:
    - 初始化任务状态
    - 更新子任务结果
    - 推进并行组
    - Checkpoint 到磁盘（JSON 文件）
    - 从 Checkpoint 恢复
    """

    def __init__(self, checkpoint_dir: str = "./checkpoints"):
        self.checkpoint_dir = checkpoint_dir
        os.makedirs(checkpoint_dir, exist_ok=True)

    def initialize(self, task_id: str, dag: TaskDAG) -> SwarmState:
        """为新任务创建初始状态。"""
        return SwarmState(task_id=task_id, dag=dag)

    def update_subtask(self, state: SwarmState, result: SubtaskResult) -> SwarmState:
        """更新某个子任务的结果。"""
        state.subtask_results[result.subtask_id] = result
        return state

    def advance_group(self, state: SwarmState) -> SwarmState:
        """推进到下一个并行组。"""
        state.current_group += 1
        return state

    def checkpoint(self, state: SwarmState) -> str:
        """将当前状态序列化到磁盘。

        返回 checkpoint 文件路径。
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{state.task_id}_{timestamp}.json"
        path = os.path.join(self.checkpoint_dir, filename)

        state.checkpoint_path = path
        with open(path, "w", encoding="utf-8") as f:
            f.write(state.model_dump_json(indent=2))

        return path

    def resume(self, task_id: str) -> SwarmState:
        """从最新的 checkpoint 恢复任务状态。"""
        checkpoints = sorted(
            [f for f in os.listdir(self.checkpoint_dir) if f.startswith(task_id)],
            reverse=True,
        )
        if not checkpoints:
            raise FileNotFoundError(
                f"No checkpoint found for task '{task_id}' in {self.checkpoint_dir}"
            )

        latest = checkpoints[0]
        path = os.path.join(self.checkpoint_dir, latest)

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        state = SwarmState.model_validate(data)
        state.checkpoint_path = path
        return state

    def list_checkpoints(self, task_id: str | None = None) -> list[str]:
        """列出所有 checkpoint 文件。"""
        files = os.listdir(self.checkpoint_dir)
        if task_id:
            files = [f for f in files if f.startswith(task_id)]
        return sorted(files)

    def cleanup(self, task_id: str, keep_latest: int = 3):
        """清理旧 checkpoint，只保留最近 N 个。"""
        checkpoints = sorted(
            [f for f in os.listdir(self.checkpoint_dir) if f.startswith(task_id)]
        )
        for old in checkpoints[:-keep_latest]:
            os.remove(os.path.join(self.checkpoint_dir, old))
