import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  Pressable,
  Image,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BUSINESSES,
  PROPERTIES,
  MARKETS,
  LUXURY_ITEMS,
  MISSION_DEFS,
  DAILY_TEMPLATES,
  IMAGE_SOURCES,
  TAB_META,
} from './src/data';
import {
  clamp,
  formatCompactNumber,
  formatDuration,
  formatMoney,
  formatPercent,
  groupBy,
  randomFrom,
  rollingHistory,
  seededIndexSet,
  todayKey,
} from './src/utils';

const STORAGE_KEY = 'empire-ledger-mobile-save-v1';
const SAVE_DEBOUNCE_MS = 1800;
const TICK_MS = 250;
const OFFLINE_CAP_MS = 1000 * 60 * 60 * 8;

const INITIAL_CASH = 6000;

const BUSINESS_BY_ID = Object.fromEntries(BUSINESSES.map((item) => [item.id, item]));
const PROPERTY_BY_ID = Object.fromEntries(PROPERTIES.map((item) => [item.id, item]));
const MARKET_BY_ID = Object.fromEntries(MARKETS.map((item) => [item.id, item]));
const LUXURY_BY_ID = Object.fromEntries(LUXURY_ITEMS.map((item) => [item.id, item]));

const BOOST_CATALOG = [
  {
    id: 'boost-income',
    title: 'Campagne nationale',
    description: 'Double les revenus passifs pendant 90 secondes.',
    cost: 15000,
    durationMs: 90000,
    effect: 'income',
    value: 1,
  },
  {
    id: 'boost-action',
    title: 'Turbo opération',
    description: 'Actions plus rapides et plus rentables pendant 75 secondes.',
    cost: 22000,
    durationMs: 75000,
    effect: 'action',
    value: 0.35,
  },
  {
    id: 'boost-market',
    title: 'Salle des marchés',
    description: 'Améliore les ventes et les scans marché pendant 120 secondes.',
    cost: 28000,
    durationMs: 120000,
    effect: 'market',
    value: 0.25,
  },
];

const TAB_DESCRIPTIONS = {
  dashboard: 'Pilotage central, missions, boosts et métriques.',
  business: 'Business denses avec achat, upgrades, auto et événements.',
  realEstate: 'Catalogue immobilier large avec rénovation et gestion.',
  markets: 'Actions et cryptos locales simulées hors ligne.',
  luxury: 'Prestige, bonus passifs et accélérateurs de gameplay.',
  profile: 'Statistiques, logs et succès de progression.',
};

function buildEmptyBusinessState() {
  return BUSINESSES.reduce((acc, item) => {
    acc[item.id] = { owned: 0, level: 0, automated: false, efficiencyBonus: 0, reputationBonus: 0 };
    return acc;
  }, {});
}

function buildEmptyPropertyState() {
  return PROPERTIES.reduce((acc, item) => {
    acc[item.id] = { owned: 0, renovation: 0, furnished: false, security: false, managed: false };
    return acc;
  }, {});
}

function buildEmptyMarketState() {
  return MARKETS.reduce((acc, item) => {
    acc[item.id] = {
      price: item.basePrice,
      quantity: 0,
      avgPrice: 0,
      history: Array.from({ length: 14 }, (_, index) => item.basePrice * (0.92 + index * 0.01)),
      lastChangePct: 0,
      news: 'Marché stable',
    };
    return acc;
  }, {});
}

function buildEmptyLuxuryState() {
  return LUXURY_ITEMS.reduce((acc, item) => {
    acc[item.id] = { owned: false };
    return acc;
  }, {});
}

function getSnapshot(game) {
  return {
    businessesOwned: countOwnedBusinesses(game),
    propertiesOwned: countOwnedProperties(game),
    marketOwned: countOwnedMarkets(game),
    luxuryOwned: countOwnedLuxury(game),
    manualActions: game.stats.manualActions,
    marketBuys: game.stats.marketBuys,
    totalEarned: game.stats.totalEarned,
    businessUpgrades: game.stats.businessUpgrades,
    propertyUpgrades: game.stats.propertyUpgrades,
  };
}

function generateDailyChallenges(snapshot, seedKey) {
  const numericSeed = Number(seedKey.replaceAll('-', ''));
  const picked = seededIndexSet(DAILY_TEMPLATES.length, numericSeed, 3);
  return picked.map((index) => {
    const template = DAILY_TEMPLATES[index];
    return {
      ...template,
      baseline: {
        businessesOwned: snapshot.businessesOwned,
        propertiesOwned: snapshot.propertiesOwned,
        marketOwned: snapshot.marketOwned,
        luxuryOwned: snapshot.luxuryOwned,
        manualActions: snapshot.manualActions,
        marketBuys: snapshot.marketBuys,
        totalEarned: snapshot.totalEarned,
        businessUpgrades: snapshot.businessUpgrades,
        propertyUpgrades: snapshot.propertyUpgrades,
      },
      claimed: false,
    };
  });
}

function createInitialGameState() {
  const now = Date.now();
  const base = {
    cash: INITIAL_CASH,
    xp: 0,
    level: 1,
    prestige: 0,
    activeTab: 'dashboard',
    lastSavedAt: now,
    businesses: buildEmptyBusinessState(),
    properties: buildEmptyPropertyState(),
    markets: buildEmptyMarketState(),
    luxuries: buildEmptyLuxuryState(),
    boosts: [],
    claimedMissions: [],
    dailySeedKey: todayKey(),
    dailyChallenges: [],
    action: null,
    stats: {
      totalEarned: 0,
      totalSpent: 0,
      manualActions: 0,
      marketBuys: 0,
      businessUpgrades: 0,
      propertyUpgrades: 0,
      biggestDeal: 0,
    },
    logs: [
      { id: String(now), tone: 'accent', text: 'Empire Ledger initialisé. Le jeu tourne entièrement hors ligne.' },
    ],
  };
  base.dailyChallenges = generateDailyChallenges(getSnapshot(base), base.dailySeedKey);
  return base;
}

function normalizeGameState(candidate) {
  const base = createInitialGameState();
  const next = {
    ...base,
    ...candidate,
    businesses: { ...base.businesses, ...(candidate?.businesses || {}) },
    properties: { ...base.properties, ...(candidate?.properties || {}) },
    markets: { ...base.markets, ...(candidate?.markets || {}) },
    luxuries: { ...base.luxuries, ...(candidate?.luxuries || {}) },
    stats: { ...base.stats, ...(candidate?.stats || {}) },
    boosts: Array.isArray(candidate?.boosts) ? candidate.boosts : [],
    claimedMissions: Array.isArray(candidate?.claimedMissions) ? candidate.claimedMissions : [],
    logs: Array.isArray(candidate?.logs) && candidate.logs.length ? candidate.logs : base.logs,
  };

  if (!candidate?.dailySeedKey) {
    next.dailySeedKey = todayKey();
  }
  if (!Array.isArray(candidate?.dailyChallenges) || !candidate.dailyChallenges.length) {
    next.dailyChallenges = generateDailyChallenges(getSnapshot(next), next.dailySeedKey);
  }
  return next;
}

function appendLog(game, text, tone = 'normal') {
  const nextEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, tone };
  return {
    ...game,
    logs: [nextEntry, ...game.logs].slice(0, 12),
  };
}

function countOwnedBusinesses(game) {
  return Object.values(game.businesses).reduce((sum, state) => sum + (state.owned || 0), 0);
}

function countOwnedProperties(game) {
  return Object.values(game.properties).reduce((sum, state) => sum + (state.owned || 0), 0);
}

function countOwnedMarkets(game) {
  return Object.values(game.markets).reduce((sum, state) => sum + ((state.quantity || 0) > 0 ? 1 : 0), 0);
}

function countOwnedLuxury(game) {
  return Object.values(game.luxuries).reduce((sum, state) => sum + (state.owned ? 1 : 0), 0);
}

function countAutomatedBusinesses(game) {
  return Object.values(game.businesses).reduce((sum, state) => sum + (state.automated ? 1 : 0), 0);
}

function getLuxuryBonus(game, bonusType) {
  return LUXURY_ITEMS.reduce((sum, item) => {
    if (!game.luxuries[item.id]?.owned || item.bonusType !== bonusType) return sum;
    return sum + item.bonusValue;
  }, 0);
}

function getBoostValue(game, effect) {
  return game.boosts.reduce((sum, boost) => (boost.effect === effect ? sum + boost.value : sum), 0);
}

function computeBusinessIncomePerSecond(game) {
  return BUSINESSES.reduce((sum, item) => {
    const state = game.businesses[item.id];
    if (!state?.owned) return sum;
    const scale = 1 + state.level * 0.42 + state.efficiencyBonus + state.reputationBonus * 0.5;
    const automationBonus = state.automated ? 0.18 : 0;
    const basePerSecond = (item.baseIncome * state.owned) / item.cycleSeconds;
    return sum + basePerSecond * (scale + automationBonus);
  }, 0);
}

function computePropertyIncomePerSecond(game) {
  return PROPERTIES.reduce((sum, item) => {
    const state = game.properties[item.id];
    if (!state?.owned) return sum;
    const occupancy = item.occupancy + (state.security ? 0.02 : 0) + (state.managed ? 0.03 : 0);
    const renovation = 1 + item.renovationPotential * state.renovation + (state.furnished ? 0.08 : 0);
    const maintenanceFactor = 1 - item.maintenance / 1000;
    const perSecond = item.rent * state.owned * clamp(occupancy, 0.85, 0.99) * renovation * maintenanceFactor / 18;
    return sum + perSecond;
  }, 0);
}

function computePassiveIncome(game) {
  const luxuryPassive = getLuxuryBonus(game, 'PassiveIncome');
  const incomeBoost = getBoostValue(game, 'income');
  const base = computeBusinessIncomePerSecond(game) + computePropertyIncomePerSecond(game);
  return base * (1 + luxuryPassive + incomeBoost);
}

function computePortfolioValue(game) {
  return MARKETS.reduce((sum, item) => {
    const state = game.markets[item.id];
    return sum + state.price * state.quantity;
  }, 0);
}

function computePropertyValue(game) {
  return PROPERTIES.reduce((sum, item) => {
    const state = game.properties[item.id];
    const upgradeFactor = 1 + state.renovation * item.renovationPotential + (state.furnished ? 0.06 : 0) + (state.security ? 0.03 : 0);
    return sum + item.resaleBase * state.owned * upgradeFactor;
  }, 0);
}

function computeBusinessValue(game) {
  return BUSINESSES.reduce((sum, item) => {
    const state = game.businesses[item.id];
    if (!state.owned) return sum;
    return sum + item.price * state.owned * (0.8 + state.level * 0.18 + (state.automated ? 0.15 : 0));
  }, 0);
}

function computeLuxuryValue(game) {
  return LUXURY_ITEMS.reduce((sum, item) => sum + (game.luxuries[item.id]?.owned ? item.price : 0), 0);
}

function computeNetWorth(game) {
  return game.cash + computePortfolioValue(game) + computePropertyValue(game) + computeBusinessValue(game) + computeLuxuryValue(game);
}

function getActionConfig(game, tabKey) {
  const passive = computePassiveIncome(game);
  const levelFactor = 1 + game.level * 0.05;
  const actionRewardBonus = getLuxuryBonus(game, 'ActionReward') + getBoostValue(game, 'action');
  const actionDurationReduction = getLuxuryBonus(game, 'ActionDuration') + getBoostValue(game, 'action');
  const automatedBusinesses = countAutomatedBusinesses(game);
  const ownedProperties = countOwnedProperties(game);

  const byTab = {
    dashboard: { baseReward: Math.max(280, passive * 7 + game.level * 80), baseDuration: 5200 + Math.max(0, 2200 - game.level * 40), auto: automatedBusinesses >= 5 },
    business: { baseReward: Math.max(350, passive * 9 + countOwnedBusinesses(game) * 120), baseDuration: 4800 + Math.max(0, 1800 - automatedBusinesses * 120), auto: automatedBusinesses >= 3 },
    realEstate: { baseReward: Math.max(550, passive * 12 + ownedProperties * 180), baseDuration: 5600 + Math.max(0, 1800 - ownedProperties * 65), auto: ownedProperties >= 6 },
    markets: { baseReward: Math.max(420, passive * 10 + countOwnedMarkets(game) * 160), baseDuration: 4200 + Math.max(0, 1200 - countOwnedMarkets(game) * 55), auto: countOwnedMarkets(game) >= 8 },
    luxury: { baseReward: Math.max(600, passive * 11 + countOwnedLuxury(game) * 420), baseDuration: 6100, auto: countOwnedLuxury(game) >= 5 },
    profile: { baseReward: Math.max(300, passive * 8 + computeNetWorth(game) * 0.00002), baseDuration: 5000, auto: game.level >= 12 },
  }[tabKey];

  return {
    reward: Math.round(byTab.baseReward * levelFactor * (1 + actionRewardBonus)),
    durationMs: Math.round(clamp(byTab.baseDuration * (1 - actionDurationReduction), 1800, 9000)),
    auto: byTab.auto,
  };
}

function simulateMarketStep(game, deltaSec) {
  const nextMarkets = { ...game.markets };
  let nextGame = game;
  let pickedNews = null;

  MARKETS.forEach((asset) => {
    const current = nextMarkets[asset.id];
    const marketBoost = getBoostValue(game, 'market');
    const edge = getLuxuryBonus(game, 'MarketEdge') + marketBoost * 0.5;
    const randomShock = (Math.random() - 0.5) * asset.volatility * Math.sqrt(deltaSec);
    const trend = asset.drift * deltaSec;
    const newsShock = current.newsEffect ? current.newsEffect * deltaSec : 0;
    const pct = clamp(trend + randomShock + newsShock, asset.type === 'crypto' ? -0.15 : -0.08, asset.type === 'crypto' ? 0.15 : 0.08);
    const nextPrice = Math.max(asset.type === 'crypto' ? 0.1 : 3, current.price * (1 + pct));
    nextMarkets[asset.id] = {
      ...current,
      price: nextPrice,
      lastChangePct: pct,
      history: rollingHistory(current.history, nextPrice),
      newsEffect: (current.newsEffect || 0) * 0.88,
    };
    const dividendGain = asset.dividendYield > 0 && current.quantity > 0 ? (nextPrice * current.quantity * asset.dividendYield * deltaSec) / 4000 : 0;
    if (dividendGain > 0) {
      nextGame = { ...nextGame, cash: nextGame.cash + dividendGain, stats: { ...nextGame.stats, totalEarned: nextGame.stats.totalEarned + dividendGain } };
    }
  });

  if (Math.random() < deltaSec / 16) {
    const chosen = randomFrom(MARKETS);
    const tone = Math.random() > 0.45 ? 1 : -1;
    const intensity = chosen.type === 'crypto' ? 0.02 : 0.008;
    const title = tone > 0
      ? `${chosen.symbol} reçoit une note interne optimiste.`
      : `${chosen.symbol} subit une rumeur de correction.`;
    nextMarkets[chosen.id] = {
      ...nextMarkets[chosen.id],
      news: title,
      newsEffect: tone * intensity * (1 - edge * 0.45),
    };
    pickedNews = title;
  }

  nextGame = { ...nextGame, markets: nextMarkets };
  if (pickedNews) nextGame = appendLog(nextGame, pickedNews, pickedNews.includes('optimiste') ? 'positive' : 'warning');
  return nextGame;
}

function maybeTriggerRandomEvent(game, deltaSec) {
  if (Math.random() >= deltaSec / 24) return game;

  const ownedBusinessItems = BUSINESSES.filter((item) => game.businesses[item.id]?.owned > 0);
  const ownedPropertyItems = PROPERTIES.filter((item) => game.properties[item.id]?.owned > 0);
  const eventType = randomFrom(['business', 'property']);

  if (eventType === 'business' && ownedBusinessItems.length) {
    const item = randomFrom(ownedBusinessItems);
    const state = game.businesses[item.id];
    const bonus = item.baseIncome * state.owned * (2 + state.level * 0.2);
    return appendLog(
      { ...game, cash: game.cash + bonus, stats: { ...game.stats, totalEarned: game.stats.totalEarned + bonus, biggestDeal: Math.max(game.stats.biggestDeal, bonus) } },
      `${item.name} cartonne sur un pic de demande. +${formatMoney(bonus)}`,
      'positive'
    );
  }

  if (ownedPropertyItems.length) {
    const item = randomFrom(ownedPropertyItems);
    const bonus = item.rent * 6;
    return appendLog(
      { ...game, cash: game.cash + bonus, stats: { ...game.stats, totalEarned: game.stats.totalEarned + bonus, biggestDeal: Math.max(game.stats.biggestDeal, bonus) } },
      `Une location premium sur ${item.name} vient d’être signée. +${formatMoney(bonus)}`,
      'accent'
    );
  }

  return game;
}

function recalculateLevel(game) {
  const level = Math.max(1, Math.floor(game.xp / 180) + 1);
  return level === game.level ? game : { ...game, level };
}

function advanceGame(game, deltaMs) {
  const deltaSec = deltaMs / 1000;
  let next = { ...game, lastSavedAt: Date.now() };

  if (next.dailySeedKey !== todayKey()) {
    next = {
      ...next,
      dailySeedKey: todayKey(),
      dailyChallenges: generateDailyChallenges(getSnapshot(next), todayKey()),
    };
    next = appendLog(next, 'Nouveau jour local détecté. Les défis ont été renouvelés.', 'accent');
  }

  const passive = computePassiveIncome(next);
  const earned = passive * deltaSec;
  next.cash += earned;
  next.stats = { ...next.stats, totalEarned: next.stats.totalEarned + earned };

  if (next.boosts.length) {
    next.boosts = next.boosts
      .map((boost) => ({ ...boost, remainingMs: boost.remainingMs - deltaMs }))
      .filter((boost) => boost.remainingMs > 0);
  }

  if (next.action) {
    const remainingMs = next.action.remainingMs - deltaMs;
    if (remainingMs <= 0) {
      const critChance = clamp(0.08 + getLuxuryBonus(next, 'ActionReward') * 0.4 + next.level * 0.002, 0.08, 0.35);
      const crit = Math.random() < critChance;
      const reward = Math.round(next.action.reward * (crit ? 1.9 : 1));
      next.cash += reward;
      next.xp += crit ? 18 : 12;
      next.stats = {
        ...next.stats,
        totalEarned: next.stats.totalEarned + reward,
        manualActions: next.stats.manualActions + 1,
        biggestDeal: Math.max(next.stats.biggestDeal, reward),
      };
      next = appendLog(next, `${next.action.label} terminé${crit ? ' avec bonus critique' : ''}. +${formatMoney(reward)}`, crit ? 'positive' : 'accent');
      if (next.action.auto) {
        const cfg = getActionConfig(next, next.action.tab);
        next.action = {
          tab: next.action.tab,
          label: TAB_META.find((item) => item.key === next.action.tab)?.actionLabel || 'Action',
          remainingMs: cfg.durationMs,
          durationMs: cfg.durationMs,
          reward: cfg.reward,
          auto: cfg.auto,
        };
      } else {
        next.action = null;
      }
    } else {
      next.action = { ...next.action, remainingMs };
    }
  }

  next = simulateMarketStep(next, deltaSec);
  next = maybeTriggerRandomEvent(next, deltaSec);

  const prestigeFromLuxury = Math.round(getLuxuryBonus(next, 'Prestige'));
  const prestigeFromScale = Math.floor(countOwnedLuxury(next) * 12 + countOwnedProperties(next) * 2);
  next.prestige = prestigeFromLuxury + prestigeFromScale;
  next = recalculateLevel(next);

  return next;
}

function applyOfflineProgress(game) {
  const now = Date.now();
  const elapsedMs = clamp(now - (game.lastSavedAt || now), 0, OFFLINE_CAP_MS);
  if (elapsedMs <= 2000) return game;

  let next = { ...game };
  const chunks = Math.max(1, Math.floor(elapsedMs / 5000));
  const slice = elapsedMs / chunks;
  for (let i = 0; i < chunks; i += 1) {
    next = advanceGame(next, slice);
  }
  const offlineCash = next.cash - game.cash;
  next = appendLog(next, `Progression hors ligne appliquée: +${formatMoney(offlineCash)} sur ${Math.floor(elapsedMs / 60000)} min.`, 'positive');
  return next;
}
