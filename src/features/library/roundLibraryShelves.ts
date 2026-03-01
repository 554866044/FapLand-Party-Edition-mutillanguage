import type { InstalledRound } from "../../services/db";
import type { RoundRenderRow } from "../../routes/roundRows";

export type RoundLibraryCardItem = {
  key: string;
  round: InstalledRound;
  renderIndex: number;
};

export type RoundLibraryShelf =
  | {
      kind: "group-header";
      key: string;
      row: Extract<RoundRenderRow, { kind: "hero-group" | "playlist-group" }>;
    }
  | {
      kind: "card-row";
      key: string;
      items: RoundLibraryCardItem[];
    };

export function buildRoundLibraryShelves(
  rows: RoundRenderRow[],
  columns: number,
  expandedGroupKeys: ReadonlySet<string>,
): RoundLibraryShelf[] {
  const safeColumns = Math.max(1, Math.floor(columns));
  const shelves: RoundLibraryShelf[] = [];
  let pendingStandalone: RoundLibraryCardItem[] = [];
  let nextRenderIndex = 0;

  const flushStandalone = () => {
    if (pendingStandalone.length === 0) return;
    shelves.push(...chunkCardItems(pendingStandalone, safeColumns, "standalone"));
    pendingStandalone = [];
  };

  for (const row of rows) {
    if (row.kind === "standalone") {
      pendingStandalone.push({
        key: row.round.id,
        round: row.round,
        renderIndex: nextRenderIndex,
      });
      nextRenderIndex += 1;
      continue;
    }

    flushStandalone();
    shelves.push({
      kind: "group-header",
      key: `${row.groupKey}:header`,
      row,
    });

    if (!expandedGroupKeys.has(row.groupKey)) {
      continue;
    }

    shelves.push(
      ...chunkCardItems(
        row.rounds.map((round) => {
          const item: RoundLibraryCardItem = {
            key: `${row.groupKey}:${round.id}`,
            round,
            renderIndex: nextRenderIndex,
          };
          nextRenderIndex += 1;
          return item;
        }),
        safeColumns,
        row.groupKey,
      ),
    );
  }

  flushStandalone();
  return shelves;
}

function chunkCardItems(items: RoundLibraryCardItem[], columns: number, keyPrefix: string): RoundLibraryShelf[] {
  const shelves: RoundLibraryShelf[] = [];

  for (let index = 0; index < items.length; index += columns) {
    shelves.push({
      kind: "card-row",
      key: `${keyPrefix}:row:${index / columns}`,
      items: items.slice(index, index + columns),
    });
  }

  return shelves;
}
