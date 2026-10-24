// Data shapes exchanged between the main process and the Files / Monitor apps.

export interface FileEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
  ctime: number;
  ext: string;
  hidden: boolean;
  link: boolean;
}

export interface Place {
  id: string;
  name: string;
  path: string;
  kind: 'folder' | 'drive' | 'home' | 'desktop' | 'documents' | 'downloads' | 'pictures' | 'music' | 'videos' | 'recycle';
  free?: number;
  total?: number;
}

export type FsError = 'denied' | 'notfound' | 'exists' | 'busy' | 'invalid' | 'unknown';

export interface FileOperation {
  id: string;
  kind: 'copy' | 'move' | 'delete' | 'extract' | 'compress';
  total: number;
  done: number;
  current: string;
  error?: string;
  finished: boolean;
}

export interface FileProperties {
  path: string;
  name: string;
  dir: boolean;
  size: number;
  files: number;
  folders: number;
  partial: boolean;
  created: number;
  modified: number;
  accessed: number;
  readonly: boolean;
}

export interface ProcRow {
  pid: number;
  ppid: number;
  name: string;
  display: string;
  path: string | null;
  icon: string | null;
  cpu: number;
  memory: number;
  disk: number;
  gpu: number;
  threads: number;
  kind: 'app' | 'background' | 'system';
  hung: boolean;
  critical: boolean;
}

export interface MonitorSampleDto {
  at: number;
  cpu: number;
  memUsed: number;
  memTotal: number;
  gpu: number | null;
  diskBytes: number | null;
  diskBusy: number | null;
  netDown: number | null;
  netUp: number | null;
  processes: ProcRow[];
  counts: { processes: number; threads: number; apps: number; hung: number };
}

export interface StartupItemDto {
  id: string;
  name: string;
  command: string;
  source: 'HKCU' | 'HKLM' | 'HKLM32' | 'StartupUser' | 'StartupCommon';
  enabled: boolean;
  canToggle: boolean;
  icon: string | null;
}
