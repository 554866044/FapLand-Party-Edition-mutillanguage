import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildRoundLibraryShelves, type RoundLibraryCardItem, type RoundLibraryShelf } from "../roundLibraryShelves";
import type { RoundRenderRow } from "../../../routes/roundRows";

const GROUP_HEADER_ESTIMATE_PX = 88;
const CARD_ROW_ESTIMATE_PX = 480;
const SHELF_GAP_PX = 20;

type VirtualizedRoundLibraryGridProps = {
  rows: RoundRenderRow[];
  expandedGroupKeys: ReadonlySet<string>;
  scrollContainer: HTMLElement | null;
  renderCard: (item: RoundLibraryCardItem) => ReactNode;
  renderGroupHeader: (shelf: Extract<RoundLibraryShelf, { kind: "group-header" }>) => ReactNode;
};

export function VirtualizedRoundLibraryGrid({
  rows,
  expandedGroupKeys,
  scrollContainer,
  renderCard,
  renderGroupHeader,
}: VirtualizedRoundLibraryGridProps) {
  const [columns, setColumns] = useState(1);
  const [shouldVirtualize, setShouldVirtualize] = useState(false);

  useEffect(() => {
    if (!scrollContainer) {
      setShouldVirtualize(false);
      return;
    }

    const updateLayout = () => {
      const width = scrollContainer.clientWidth || window.innerWidth || 0;
      setColumns(width >= 1280 ? 3 : width >= 640 ? 2 : 1);
      setShouldVirtualize(scrollContainer.clientHeight > 0);
    };

    updateLayout();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateLayout);
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [scrollContainer]);

  const shelves = useMemo(
    () => buildRoundLibraryShelves(rows, columns, expandedGroupKeys),
    [columns, expandedGroupKeys, rows],
  );

  const shelfRenderer = useMemo(
    () => (shelf: RoundLibraryShelf) => {
      if (shelf.kind === "group-header") {
        return renderGroupHeader(shelf);
      }

      return (
        <div
          className="grid grid-cols-1 gap-5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {shelf.items.map((item) => renderCard(item))}
        </div>
      );
    },
    [columns, renderCard, renderGroupHeader],
  );

  const virtualizer = useVirtualizer({
    count: shelves.length,
    getScrollElement: () => scrollContainer,
    estimateSize: (index) => {
      const shelf = shelves[index];
      return shelf?.kind === "group-header"
        ? GROUP_HEADER_ESTIMATE_PX + SHELF_GAP_PX
        : CARD_ROW_ESTIMATE_PX + SHELF_GAP_PX;
    },
    overscan: 4,
    measureElement: (element) => element.getBoundingClientRect().height,
    useAnimationFrameWithResizeObserver: true,
    enabled: shouldVirtualize,
  });

  if (!shouldVirtualize) {
    return (
      <div className="space-y-5">
        {shelves.map((shelf) => (
          <div key={shelf.key}>{shelfRenderer(shelf)}</div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="relative"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const shelf = shelves[item.index];
        if (!shelf) return null;

        return (
          <div
            key={shelf.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            className="absolute left-0 top-0 w-full pb-5"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {shelfRenderer(shelf)}
          </div>
        );
      })}
    </div>
  );
}
