"use client";

import { useState, useEffect, useCallback } from "react";

const msgs: Record<string, Record<string, string>> = {
  en: {
    newTask: "New Task", send: "Send", stop: "Stop", settings: "Settings",
    decomposing: "Analyzing task", complete: "Complete", running: "Running",
    waiting: "Waiting", edit: "Edit", copy: "Copy", rerun: "Rerun", cancel: "Cancel",
    noConvs: "No conversations", search: "Search...", files: "Files",
    taskPlaceholder: "Describe your task...", emptyTitle: "What do you want to research?",
    emptyDesc: "Describe your task to get started.", deleteConfirm: "Delete this conversation?",
    connectionLost: "Connection lost", startTaskFailed: "Failed to start task",
    completed: "Completed", failed: "Failed", pending: "Pending",
  },
  zh: {
    newTask: "新建任务", send: "发送", stop: "停止", settings: "设置",
    decomposing: "分析任务中", complete: "完成", running: "运行中",
    waiting: "等待中", edit: "编辑", copy: "复制", rerun: "重新执行", cancel: "取消",
    noConvs: "暂无对话", search: "搜索...", files: "文件",
    taskPlaceholder: "描述你的任务...", emptyTitle: "想要研究什么？",
    emptyDesc: "描述你的任务，开始使用 AgentSwarm。", deleteConfirm: "确定删除此对话？",
    connectionLost: "连接已断开", startTaskFailed: "启动任务失败",
    completed: "已完成", failed: "失败", pending: "等待中",
  },
};

export function useT() {
  const [lang, setLang] = useState("en");
  useEffect(() => {
    setLang(localStorage.getItem("lang") || "en");
    const onStorage = () => setLang(localStorage.getItem("lang") || "en");
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return useCallback((key: string) => (msgs[lang] || msgs.en)[key] || key, [lang]);
}
