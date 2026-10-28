// DealBadge — current price / discount from IsThereAnyDeal, if tracked.
// Renders nothing if there's no price data yet (game not resolved to an
// ITAD id, or sync-deals hasn't run).
export default function DealBadge({ game }) {
  if (game?.deal_price == null) return null;
  const onSale = game.deal_cut > 0;
  const badge = (
    <span className={`deal-badge ${onSale ? "deal-badge-sale" : ""}`}>
      {onSale && <span className="deal-cut">-{game.deal_cut}%</span>}
      <span className="deal-price">${Number(game.deal_price).toFixed(2)}</span>
      {onSale && game.deal_regular != null && (
        <span className="deal-regular">${Number(game.deal_regular).toFixed(2)}</span>
      )}
    </span>
  );
  return game.deal_url ? (
    <a href={game.deal_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      {badge}
    </a>
  ) : badge;
}
