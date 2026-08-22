// Shapes and limits shared by the /db table browser's server routes and its UI.
// Kept free of imports so the client bundle doesn't drag in the Supabase client.

export type ColumnMeta = {
  name: string;
  type: string;
  nullable: boolean;
  is_primary_key: boolean;
  comment: string | null;
};

export type TableMeta = {
  name: string;
  kind: "table" | "view" | "materialized_view";
  comment: string | null;
  columns: ColumnMeta[];
};

export type BrowseRow = Record<string, unknown> & {
  /** Columns whose value was shortened for the grid; the drawer can refetch them. */
  __truncated?: string[];
};

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];
export const MAX_PAGE_SIZE = 200;

// Long text — base64 images, transcripts, big jsonb blobs — is cut down before
// it's sent to the grid, which only ever shows the first line of a cell anyway.
// Without this, a page of voicemap_images would be tens of megabytes.
export const MAX_CELL_CHARS = 512;
