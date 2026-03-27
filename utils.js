export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const formatMoney = (value) => {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${value < 0 ? '-' : ''}$${(abs / 1e12).toFixed(abs >= 1e13 ? 1 : 2)}T`;
  if (abs >= 1e9) return `${value < 0 ? '-' : ''}$${(abs / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `${value < 0 ? '-' : ''}$${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e3) return `${value < 0 ? '-' : ''}$${(abs / 1e3).toFixed(abs >= 1e4 ? 1 : 2)}K`;
  return `${value < 0 ? '-' : ''}$${abs.toFixed(abs >= 100 ? 0 : 2)}`;
};

export const formatCompactNumber = (value) => {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(value >= 100 ? 0 : 1);
};

export const formatPercent = (value) => `${(value * 100).toFixed(0)}%`;

export const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export const groupBy = (items, getter) => items.reduce((acc, item) => {
  const key = getter(item);
  if (!acc[key]) acc[key] = [];
  acc[key].push(item);
  return acc;
}, {});

export const todayKey = () => {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getDate()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const randomFrom = (items) => items[Math.floor(Math.random() * items.length)];

export const rollingHistory = (history, next, max = 18) => {
  const updated = [...history, next];
  return updated.slice(Math.max(updated.length - max, 0));
};

export const seededIndexSet = (length, seed, count) => {
  const indices = [];
  let current = seed;
  const used = new Set();
  while (indices.length < Math.min(count, length)) {
    current = (current * 9301 + 49297) % 233280;
    const idx = Math.floor((current / 233280) * length);
    if (!used.has(idx)) {
      used.add(idx);
      indices.push(idx);
    }
  }
  return indices;
};
