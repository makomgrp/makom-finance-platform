import { FileCheck2, PhoneCall, FileSearch, Clock, type LucideIcon } from "lucide-react";

export const PENDING_TASKS: { id: string; key: "task1" | "task2" | "task3" | "task4"; icon: LucideIcon }[] = [
  { id: "task-001", key: "task1", icon: FileCheck2 },
  { id: "task-002", key: "task2", icon: PhoneCall },
  { id: "task-003", key: "task3", icon: FileSearch },
  { id: "task-004", key: "task4", icon: Clock },
];
