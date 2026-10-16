/** The details a script file carries about itself. */
export interface ScriptMeta {
  id: string;
  title: string;
  author: string;
  format: string;
  created_at: string;
  updated_at: string;
  page_count: number;
  size_bytes: number;
  color: string;
  pinned: boolean;
  sort_order: number;
  preview: string;
}
