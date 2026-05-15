export function deriveParlayOutcome(row) {
  if (!row?.resolved) return 'pending';
  if (row.hit === true) return 'win';
  if (row.hit === false) {
    const legs = Array.isArray(row.leg_results) ? row.leg_results : [];
    if (legs.length > 0) {
      const hasLoss = legs.some(lr => lr?.result === 'loss');
      const hasWin = legs.some(lr => lr?.result === 'win');
      const allPush = legs.every(lr => lr?.result === 'push');
      if (!hasLoss && !hasWin && allPush) return 'push';
    }
    return 'loss';
  }
  return 'push';
}
