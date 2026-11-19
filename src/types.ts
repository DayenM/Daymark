export type Theme = "glass_light" | "glass_dark" | "neumorphic" | "sakura_milk" | "peach_matcha" | "cherry_cola" | "midnight_ocean";
export type FontFamily = "plus-jakarta-sans" | "geist" | "inter" | "atkinson-hyperlegible-next" | "segoe-ui" | "aptos" | "arial";
export type Priority = "low" | "normal" | "high" | "urgent";
export type ViewKey = "calendar" | "briefing" | "today" | "upcoming" | "inbox" | "projects" | "notes" | "settings";

export type Task = {
  id: string;
  seriesId: string | null;
  title: string;
  status: "open" | "done";
  priority: Priority;
  dueAt: string | null;
  remindAt: string | null;
  reminderOffsetMinutes: number | null;
  recurrenceRule: string | null;
  rolloverCount: number;
  parentId: string | null;
  projectId: string | null;
  sortOrder: number;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type Project = { id: string; name: string; color: string };
export type QuickNote = {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  updatedAt: string;
};

export type WorkspaceSnapshot = {
  tasks: Task[];
  projects: Project[];
  quickNotes: QuickNote[];
  theme: Theme;
  fontFamily: FontFamily;
  widgetTransparency: number;
  appTransparency: number;
  autoStart: boolean;
  briefingAcknowledged: boolean;
  localDate: string;
};

export type TaskDraft = {
  title: string;
  priority: Priority;
  dueAt: string | null;
  reminderOffsetMinutes: number | null;
  recurrenceRule: { frequency: "daily" | "weekly" | "monthly"; interval: number; monthDay: number | null } | null;
  parentId: string | null;
  projectId: string | null;
  tags: string[];
};
