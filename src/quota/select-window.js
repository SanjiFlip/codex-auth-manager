const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const resetTime = value => typeof value === 'number' ? value * 1000 : time(value);
const measured = window => typeof window?.usedPercent === 'number' && Number.isFinite(window.usedPercent);

// Local events can repeat an empty/default reading with a fresh event timestamp.
// An explicit official query may correct usage; a local zero needs a new period.
function selectWindow(previous, next, previousAt, nextAt) {
  if (!previous) return next;
  if (!next) return previous;
  if (time(next.checkedAt || nextAt) < time(previous.checkedAt || previousAt)) return previous;
  if (measured(previous) && !measured(next)) return previous;
  if (previous.usedPercent > 0 && next.usedPercent === 0) {
    const before = resetTime(previous.resetsAt), after = resetTime(next.resetsAt);
    if (before && (!after || after <= before)) return previous;
  }
  return next;
}
module.exports = { selectWindow };
