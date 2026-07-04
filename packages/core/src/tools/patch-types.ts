export type PatchHunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: PatchChunk[] };

export type PatchChunk = {
  oldLines: string[];
  newLines: string[];
  changeContext?: string;
  isEndOfFile?: boolean;
};
