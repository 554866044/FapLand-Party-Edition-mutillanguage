import { getPerkById } from "../../game/data/perks";
import { PERK_RARITY_META, fallbackRarityFromCost, resolvePerkRarity } from "../../game/data/perkRarity";
import type { ActivePerkEffect, InventoryItem, PerkIconKey } from "../../game/types";
import { PerkIcon } from "./PerkIcon";

type InventoryTarget = {
  id: string;
  label: string;
  description?: string;
};

type PerkInventoryPanelProps = {
  title?: string;
  subtitle?: string;
  inventory: InventoryItem[];
  activeEffects?: ActivePerkEffect[];
  selectedItemId: string | null;
  onSelectItem: (itemId: string) => void;
  onUseSelectedItem: (item: InventoryItem) => void;
  onDiscardSelectedItem?: (item: InventoryItem) => void;
  useActionLabel?: string;
  discardActionLabel?: string;
  useDisabled?: boolean;
  useDisabledReason?: string | null;
  emptyStateLabel?: string;
  targets?: InventoryTarget[];
  selectedTargetId?: string | null;
  onSelectTarget?: (targetId: string) => void;
  headerBadge?: string;
};

type InventoryGroup = {
  item: InventoryItem;
  itemIds: string[];
  displayName: string;
  count: number;
  kindLabel: string;
  description: string;
  rarityMeta: typeof PERK_RARITY_META.common;
  iconKey: PerkIconKey;
};

function buildInventoryGroups(items: InventoryItem[]): InventoryGroup[] {
  const grouped = new Map<string, { item: InventoryItem; itemIds: string[] }>();

  for (const item of items) {
    const existing = grouped.get(item.perkId);
    if (existing) {
      existing.itemIds.push(item.itemId);
      continue;
    }
    grouped.set(item.perkId, { item, itemIds: [item.itemId] });
  }

  return Array.from(grouped.values())
    .map(({ item, itemIds }) => {
      const perk = getPerkById(item.perkId);
      const rarityMeta = PERK_RARITY_META[
        perk ? resolvePerkRarity(perk) : fallbackRarityFromCost(item.cost)
      ];
      return {
        item,
        itemIds,
        displayName: perk?.name ?? item.name,
        count: itemIds.length,
        kindLabel: item.kind === "perk" ? "Self buff" : "Targeted anti-perk",
        description: perk?.description ?? item.name,
        rarityMeta,
        iconKey: perk?.iconKey ?? "unknown",
      };
    })
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));
}

export function PerkInventoryPanel({
  title = "Perk Inventory",
  subtitle = "Manage your stored perks and active effects.",
  inventory,
  activeEffects = [],
  selectedItemId,
  onSelectItem,
  onUseSelectedItem,
  onDiscardSelectedItem,
  useActionLabel = "Use Item",
  discardActionLabel = "Discard Item",
  useDisabled = false,
  useDisabledReason = null,
  emptyStateLabel = "No stored items yet.",
  targets = [],
  selectedTargetId = null,
  onSelectTarget,
  headerBadge,
}: PerkInventoryPanelProps) {
  const groups = buildInventoryGroups(inventory);
  const selectedItem = inventory.find((item) => item.itemId === selectedItemId) ?? null;
  const selectedPerk = selectedItem ? getPerkById(selectedItem.perkId) : undefined;
  const selectedRarityMeta = PERK_RARITY_META[
    selectedPerk ? resolvePerkRarity(selectedPerk) : selectedItem ? fallbackRarityFromCost(selectedItem.cost) : "common"
  ];
  const selectedIconKey = selectedPerk?.iconKey ?? "unknown";

  return (
    <div className="rounded-[28px] border border-cyan-300/25 bg-[linear-gradient(160deg,rgba(6,13,24,0.96),rgba(13,24,41,0.94))] p-4 shadow-[0_25px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/75">Loadout</div>
          <h2 className="mt-1 text-xl font-black tracking-[0.04em] text-white">{title}</h2>
          <p className="mt-1 max-w-xl text-sm text-slate-200/80">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.14em] text-cyan-100">
            {inventory.length} items
          </span>
          {headerBadge && (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.14em] text-zinc-200">
              {headerBadge}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <section className="rounded-[24px] border border-white/10 bg-black/20 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-100/70">Stored Items</div>
            <div className="text-xs text-zinc-400">{groups.length} stacks</div>
          </div>
          <div className="grid max-h-[52vh] gap-2 overflow-y-auto pr-1">
            {groups.length === 0 && (
              <div className="rounded-[20px] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-zinc-400">
                {emptyStateLabel}
              </div>
            )}
            {groups.map((group) => {
              const selected = selectedItemId !== null && group.itemIds.includes(selectedItemId);
              return (
                <button
                  key={`${group.item.perkId}-${group.itemIds[0]}`}
                  type="button"
                  onClick={() => {
                    const itemId = group.itemIds[0];
                    if (itemId) onSelectItem(itemId);
                  }}
                  className={`w-full rounded-[22px] border px-4 py-3 text-left transition-all duration-150 ${selected ? group.rarityMeta.tailwind.inventorySelected : group.rarityMeta.tailwind.inventoryIdle}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-zinc-100">
                        <PerkIcon iconKey={group.iconKey} className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-100">{group.displayName}</span>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${group.rarityMeta.tailwind.badge}`}>
                            {group.rarityMeta.label}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-300">{group.kindLabel}</div>
                        <div className="mt-2 line-clamp-2 text-xs text-zinc-400">{group.description}</div>
                      </div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/25 px-2 py-1 text-[11px] font-semibold text-zinc-200">
                      x{group.count}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-300">Selected Item</div>
            {selectedItem ? (
              <>
                <div className="mt-3 flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-zinc-100">
                    <PerkIcon iconKey={selectedIconKey} className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-zinc-100">{selectedPerk?.name ?? selectedItem.name}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${selectedRarityMeta.tailwind.badge}`}>
                        {selectedRarityMeta.label}
                      </span>
                      <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-200">
                        Turn {selectedItem.acquiredTurn}
                      </span>
                    </div>
                  </div>
                </div>

                <p className="mt-4 text-sm text-zinc-300">
                  {selectedPerk?.description ?? "Stored item with no local definition."}
                </p>

                {selectedItem.kind === "antiPerk" && targets.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-400">Target Player</div>
                    <div className="grid gap-2">
                      {targets.map((target) => (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => onSelectTarget?.(target.id)}
                          className={`rounded-2xl border px-3 py-2 text-left transition-colors ${selectedTargetId === target.id
                            ? "border-cyan-300/80 bg-cyan-500/18 text-cyan-100"
                            : "border-white/10 bg-black/20 text-zinc-200 hover:border-zinc-500"
                            }`}
                        >
                          <div className="font-semibold">{target.label}</div>
                          {target.description && <div className="mt-1 text-xs text-zinc-400">{target.description}</div>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 grid gap-2">
                  <button
                    type="button"
                    disabled={useDisabled}
                    className="rounded-2xl border border-cyan-400/60 bg-cyan-500/15 px-3 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => onUseSelectedItem(selectedItem)}
                  >
                    {useActionLabel}
                  </button>
                  {onDiscardSelectedItem && (
                    <button
                      type="button"
                      className="rounded-2xl border border-amber-400/60 bg-amber-500/15 px-3 py-2.5 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-500/25"
                      onClick={() => onDiscardSelectedItem(selectedItem)}
                    >
                      {discardActionLabel}
                    </button>
                  )}
                </div>

                {useDisabledReason && (
                  <p className="mt-3 text-xs text-zinc-400">{useDisabledReason}</p>
                )}
              </>
            ) : (
              <div className="mt-3 rounded-[20px] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-zinc-400">
                Select a stored item to inspect and use it.
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-300">Active Effects</div>
              <div className="text-xs text-zinc-400">{activeEffects.length} active</div>
            </div>
            <div className="mt-3 grid gap-2">
              {activeEffects.length === 0 && (
                <div className="rounded-[20px] border border-dashed border-white/10 bg-black/20 px-4 py-5 text-xs text-zinc-400">
                  No active perk effects.
                </div>
              )}
              {activeEffects.map((effect) => {
                const perk = getPerkById(effect.id);
                const rarityMeta = PERK_RARITY_META[perk ? resolvePerkRarity(perk) : "common"];
                return (
                  <div key={`${effect.kind}-${effect.id}-${effect.remainingRounds ?? "persist"}`} className={`rounded-[18px] border px-3 py-2 ${rarityMeta.tailwind.feed}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 font-semibold text-zinc-100">
                        <PerkIcon iconKey={perk?.iconKey ?? "unknown"} className="h-4 w-4" />
                        <span>{effect.name ?? perk?.name ?? effect.id}</span>
                      </div>
                      <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-300">
                        {effect.remainingRounds === null ? "Permanent" : `${effect.remainingRounds} rounds`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
