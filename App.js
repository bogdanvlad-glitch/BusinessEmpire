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

function evaluateRequirement(game, type) {
  switch (type) {
    case 'businessOwned':
      return countOwnedBusinesses(game);
    case 'propertyOwned':
      return countOwnedProperties(game);
    case 'marketOwned':
      return countOwnedMarkets(game);
    case 'luxuryOwned':
      return countOwnedLuxury(game);
    case 'automatedBusiness':
      return countAutomatedBusinesses(game);
    case 'netWorth':
      return computeNetWorth(game);
    default:
      return 0;
  }
}

function evaluateDailyChallenge(game, challenge) {
  const snapshot = getSnapshot(game);
  switch (challenge.type) {
    case 'businessOwnedDelta':
      return snapshot.businessesOwned - challenge.baseline.businessesOwned;
    case 'propertyOwnedDelta':
      return snapshot.propertiesOwned - challenge.baseline.propertiesOwned;
    case 'manualActionsDelta':
      return snapshot.manualActions - challenge.baseline.manualActions;
    case 'marketBuyDelta':
      return snapshot.marketBuys - challenge.baseline.marketBuys;
    case 'luxuryOwnedDelta':
      return snapshot.luxuryOwned - challenge.baseline.luxuryOwned;
    case 'totalEarnedDelta':
      return snapshot.totalEarned - challenge.baseline.totalEarned;
    case 'businessUpgradeDelta':
      return snapshot.businessUpgrades - challenge.baseline.businessUpgrades;
    case 'propertyUpgradeDelta':
      return snapshot.propertyUpgrades - challenge.baseline.propertyUpgrades;
    default:
      return 0;
  }
}

function StatPill({ label, value, accent }) {
  return (
    <View style={[styles.statPill, accent && styles.statPillAccent]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <View style={styles.sectionHeader}>
      <View>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function MetricCard({ title, value, note }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricTitle}>{title}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricNote}>{note}</Text>
    </View>
  );
}

function MiniChart({ history, positive }) {
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = Math.max(max - min, 0.00001);
  return (
    <View style={styles.chartRow}>
      {history.map((value, index) => {
        const normalized = (value - min) / range;
        return (
          <View key={`${index}-${value}`} style={styles.chartBarWrap}>
            <View
              style={[
                styles.chartBar,
                positive ? styles.chartBarPositive : styles.chartBarNegative,
                { height: 10 + normalized * 42 },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function AppButton({ label, onPress, disabled, subtle }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        subtle && styles.buttonSubtle,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, subtle && styles.buttonTextSubtle]}>{label}</Text>
    </Pressable>
  );
}

function ActionCard({ game, onStartAction }) {
  const activeTab = game.activeTab;
  const meta = TAB_META.find((item) => item.key === activeTab) || TAB_META[0];
  const cfg = getActionConfig(game, activeTab);
  const action = game.action;
  const progress = action && action.tab === activeTab ? 1 - action.remainingMs / action.durationMs : 0;

  return (
    <View style={styles.actionCard}>
      <Image source={IMAGE_SOURCES[meta.imageKey]} style={styles.actionImage} />
      <View style={styles.actionContent}>
        <Text style={styles.actionEyebrow}>Action active</Text>
        <Text style={styles.actionTitle}>{meta.actionLabel}</Text>
        <Text style={styles.actionSubtitle}>
          {TAB_DESCRIPTIONS[activeTab]}
        </Text>
        <View style={styles.actionProgressShell}>
          <View style={[styles.actionProgressFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.actionMetaRow}>
          <Text style={styles.actionMetaText}>Gain estimé {formatMoney(cfg.reward)}</Text>
          <Text style={styles.actionMetaText}>Durée {formatDuration(cfg.durationMs)}</Text>
          <Text style={styles.actionMetaText}>{cfg.auto ? 'Auto dispo' : 'Auto verrouillé'}</Text>
        </View>
        <AppButton
          label={action && action.tab === activeTab ? `En cours · ${formatDuration(action.remainingMs)}` : 'Lancer'}
          onPress={onStartAction}
          disabled={Boolean(action)}
        />
      </View>
    </View>
  );
}

function App() {
  const [game, setGame] = useState(createInitialGameState());
  const [ready, setReady] = useState(false);
  const saveTimerRef = useRef(null);
  const lastTickRef = useRef(Date.now());

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!mounted) return;
        const parsed = raw ? normalizeGameState(JSON.parse(raw)) : createInitialGameState();
        const progressed = applyOfflineProgress(parsed);
        setGame(progressed);
      } catch (error) {
        setGame(createInitialGameState());
      } finally {
        if (mounted) {
          setReady(true);
          lastTickRef.current = Date.now();
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      setGame((current) => advanceGame(current, delta));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    if (!ready) return undefined;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...game, lastSavedAt: Date.now() })).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [game, ready]);

  const passiveIncome = useMemo(() => computePassiveIncome(game), [game]);
  const netWorth = useMemo(() => computeNetWorth(game), [game]);
  const marketValue = useMemo(() => computePortfolioValue(game), [game]);
  const groupedBusinesses = useMemo(() => groupBy(BUSINESSES, (item) => item.sector), []);
  const groupedProperties = useMemo(() => groupBy(PROPERTIES, (item) => item.segment), []);
  const groupedLuxury = useMemo(() => groupBy(LUXURY_ITEMS, (item) => item.category), []);
  const stocks = useMemo(() => MARKETS.filter((item) => item.type === 'stock'), []);
  const cryptos = useMemo(() => MARKETS.filter((item) => item.type === 'crypto'), []);

  const changeTab = (key) => setGame((current) => ({ ...current, activeTab: key }));

  const startAction = () => {
    if (game.action) return;
    const cfg = getActionConfig(game, game.activeTab);
    const label = TAB_META.find((item) => item.key === game.activeTab)?.actionLabel || 'Action';
    setGame((current) =>
      appendLog(
        {
          ...current,
          action: {
            tab: current.activeTab,
            label,
            remainingMs: cfg.durationMs,
            durationMs: cfg.durationMs,
            reward: cfg.reward,
            auto: cfg.auto,
          },
        },
        `${label} lancé.`,
        'accent'
      )
    );
  };

  const claimMission = (missionId) => {
    const mission = MISSION_DEFS.find((item) => item.id === missionId);
    if (!mission || game.claimedMissions.includes(missionId)) return;
    if (evaluateRequirement(game, mission.type) < mission.target) return;
    setGame((current) =>
      appendLog(
        recalculateLevel({
          ...current,
          cash: current.cash + mission.rewardCash,
          xp: current.xp + mission.rewardXp,
          claimedMissions: [...current.claimedMissions, missionId],
          stats: { ...current.stats, totalEarned: current.stats.totalEarned + mission.rewardCash },
        }),
        `${mission.title} validée. +${formatMoney(mission.rewardCash)} et ${mission.rewardXp} XP`,
        'positive'
      )
    );
  };

  const claimDaily = (challengeId) => {
    const challenge = game.dailyChallenges.find((item) => item.id === challengeId);
    if (!challenge || challenge.claimed) return;
    if (evaluateDailyChallenge(game, challenge) < challenge.target) return;
    setGame((current) =>
      appendLog(
        recalculateLevel({
          ...current,
          cash: current.cash + challenge.rewardCash,
          xp: current.xp + challenge.rewardXp,
          dailyChallenges: current.dailyChallenges.map((item) => item.id === challengeId ? { ...item, claimed: true } : item),
          stats: { ...current.stats, totalEarned: current.stats.totalEarned + challenge.rewardCash },
        }),
        `Défi du jour terminé: ${challenge.title}. +${formatMoney(challenge.rewardCash)}`,
        'positive'
      )
    );
  };

  const buyBusiness = (businessId) => {
    const business = BUSINESS_BY_ID[businessId];
    const state = game.businesses[businessId];
    const owned = state.owned;
    const price = Math.round(business.price * (1 + owned * 0.28));
    if (game.cash < price) return;
    setGame((current) => {
      const updated = {
        ...current,
        cash: current.cash - price,
        businesses: {
          ...current.businesses,
          [businessId]: {
            ...current.businesses[businessId],
            owned: current.businesses[businessId].owned + 1,
            level: Math.max(1, current.businesses[businessId].level),
            efficiencyBonus: current.businesses[businessId].efficiencyBonus + 0.015,
            reputationBonus: current.businesses[businessId].reputationBonus + 0.01,
          },
        },
        xp: current.xp + 16,
        stats: { ...current.stats, totalSpent: current.stats.totalSpent + price },
      };
      return appendLog(recalculateLevel(updated), `${business.name} acheté pour ${formatMoney(price)}.`, 'accent');
    });
  };

  const upgradeBusiness = (businessId) => {
    const business = BUSINESS_BY_ID[businessId];
    const state = game.businesses[businessId];
    if (!state.owned) return;
    const cost = Math.round(business.upgradeBaseCost * (1 + state.level * 0.6 + state.owned * 0.15));
    if (game.cash < cost) return;
    setGame((current) => {
      const updated = {
        ...current,
        cash: current.cash - cost,
        businesses: {
          ...current.businesses,
          [businessId]: {
            ...current.businesses[businessId],
            level: current.businesses[businessId].level + 1,
            efficiencyBonus: current.businesses[businessId].efficiencyBonus + 0.03,
            reputationBonus: current.businesses[businessId].reputationBonus + 0.018,
          },
        },
        xp: current.xp + 22,
        stats: {
          ...current.stats,
          totalSpent: current.stats.totalSpent + cost,
          businessUpgrades: current.stats.businessUpgrades + 1,
        },
      };
      return appendLog(recalculateLevel(updated), `${business.name} amélioré au niveau ${updated.businesses[businessId].level}.`, 'positive');
    });
  };

  const automateBusiness = (businessId) => {
    const business = BUSINESS_BY_ID[businessId];
    const state = game.businesses[businessId];
    if (!state.owned || state.automated || state.level < 3 || state.owned < 2) return;
    const cost = Math.round(business.upgradeBaseCost * 3.4);
    if (game.cash < cost) return;
    setGame((current) => {
      const updated = {
        ...current,
        cash: current.cash - cost,
        businesses: {
          ...current.businesses,
          [businessId]: {
            ...current.businesses[businessId],
            automated: true,
          },
        },
        xp: current.xp + 35,
        stats: {
          ...current.stats,
          totalSpent: current.stats.totalSpent + cost,
        },
      };
      return appendLog(recalculateLevel(updated), `${business.name} est maintenant automatisé.`, 'positive');
    });
  };

  const buyProperty = (propertyId) => {
    const item = PROPERTY_BY_ID[propertyId];
    const state = game.properties[propertyId];
    const price = Math.round(item.price * (1 + state.owned * 0.24));
    if (game.cash < price) return;
    setGame((current) => {
      const updated = {
        ...current,
        cash: current.cash - price,
        properties: {
          ...current.properties,
          [propertyId]: {
            ...current.properties[propertyId],
            owned: current.properties[propertyId].owned + 1,
          },
        },
        xp: current.xp + 24,
        stats: {
          ...current.stats,
          totalSpent: current.stats.totalSpent + price,
        },
      };
      return appendLog(recalculateLevel(updated), `${item.name} ajouté au portefeuille pour ${formatMoney(price)}.`, 'accent');
    });
  };

  const renovateProperty = (propertyId) => {
    const item = PROPERTY_BY_ID[propertyId];
    const state = game.properties[propertyId];
    if (!state.owned) return;
    const cost = Math.round(item.price * (0.08 + state.renovation * 0.04));
    if (game.cash < cost) return;
    setGame((current) => {
      const updatedState = current.properties[propertyId];
      const renovated = {
        ...updatedState,
        renovation: updatedState.renovation + 1,
        furnished: updatedState.renovation + 1 >= 2 ? true : updatedState.furnished,
        security: updatedState.renovation + 1 >= 3 ? true : updatedState.security,
        managed: updatedState.renovation + 1 >= 4 ? true : updatedState.managed,
      };
      const updated = {
        ...current,
        cash: current.cash - cost,
        properties: {
          ...current.properties,
          [propertyId]: renovated,
        },
        xp: current.xp + 28,
        stats: {
          ...current.stats,
          totalSpent: current.stats.totalSpent + cost,
          propertyUpgrades: current.stats.propertyUpgrades + 1,
        },
      };
      return appendLog(recalculateLevel(updated), `${item.name} rénové. Rang ${renovated.renovation}.`, 'positive');
    });
  };

  const buyMarket = (marketId) => {
    const item = MARKET_BY_ID[marketId];
    const state = game.markets[marketId];
    const qty = item.type === 'crypto' ? 5 : 1;
    const cost = state.price * qty;
    if (game.cash < cost) return;
    setGame((current) => {
      const currentState = current.markets[marketId];
      const nextQty = currentState.quantity + qty;
      const nextAvg = nextQty <= 0 ? 0 : ((currentState.avgPrice * currentState.quantity) + cost) / nextQty;
      const updated = {
        ...current,
        cash: current.cash - cost,
        markets: {
          ...current.markets,
          [marketId]: {
            ...current.markets[marketId],
            quantity: nextQty,
            avgPrice: nextAvg,
          },
        },
        xp: current.xp + 10,
        stats: {
          ...current.stats,
          totalSpent: current.stats.totalSpent + cost,
          marketBuys: current.stats.marketBuys + 1,
        },
      };
      return appendLog(recalculateLevel(updated), `${qty} ${item.symbol} acheté(s) pour ${formatMoney(cost)}.`, 'accent');
    });
  };

  const sellMarket = (marketId) => {
    const item = MARKET_BY_ID[marketId];
    const state = game.markets[marketId];
    const qty = item.type === 'crypto' ? 5 : 1;
    if (state.quantity < qty) return;
    const edge = getLuxuryBonus(game, 'MarketEdge') + getBoostValue(game, 'market');
    const value = state.price * qty * (1 + edge * 0.12);
    setGame((current) => {
      const currentState = current.markets[marketId];
      const updated = {
        ...current,
        cash: current.cash + value,
        markets: {
          ...current.markets,
          [marketId]: {
            ...current.markets[marketId],
            quantity: Math.max(0, currentState.quantity - qty),
            avgPrice: currentState.quantity - qty <= 0 ? 0 : currentState.avgPrice,
          },
        },
        xp: current.xp + 8,
        stats: {
          ...current.stats,
          totalEarned: current.stats.totalEarned + value,
          biggestDeal: Math.max(current.stats.biggestDeal, value),
        },
      };
      return appendLog(recalculateLevel(updated), `${qty} ${item.symbol} vendu(s) pour ${formatMoney(value)}.`, value >= currentState.avgPrice * qty ? 'positive' : 'warning');
    });
  };

  const buyLuxury = (itemId) => {
    const item = LUXURY_BY_ID[itemId];
    const state = game.luxuries[itemId];
    if (state.owned || game.cash < item.price) return;
    setGame((current) => {
      const updated = {
        ...current,
        cash: current.cash - item.price,
        luxuries: {
          ...current.luxuries,
          [itemId]: { owned: true },
        },
        xp: current.xp + 40,
        stats: {
          ...current.stats,
          totalSpent: current.stats.totalSpent + item.price,
        },
      };
      return appendLog(recalculateLevel(updated), `${item.name} rejoint la collection.`, 'positive');
    });
  };

  const activateBoost = (boostId) => {
    const boost = BOOST_CATALOG.find((item) => item.id === boostId);
    if (!boost || game.cash < boost.cost) return;
    setGame((current) => {
      const existing = current.boosts.find((item) => item.id === boostId);
      const nextBoosts = existing
        ? current.boosts.map((item) => item.id === boostId ? { ...item, remainingMs: boost.durationMs } : item)
        : [...current.boosts, { ...boost, remainingMs: boost.durationMs }];
      const updated = {
        ...current,
        cash: current.cash - boost.cost,
        boosts: nextBoosts,
        stats: { ...current.stats, totalSpent: current.stats.totalSpent + boost.cost },
      };
      return appendLog(updated, `${boost.title} activé pour ${formatDuration(boost.durationMs)}.`, 'accent');
    });
  };

  const unclaimedMissions = MISSION_DEFS.filter((mission) => !game.claimedMissions.includes(mission.id));
  const completedMissionCount = MISSION_DEFS.length - unclaimedMissions.length;
  const achievementList = [
    { label: 'Businesses', value: countOwnedBusinesses(game) },
    { label: 'Biens', value: countOwnedProperties(game) },
    { label: 'Actifs marché', value: countOwnedMarkets(game) },
    { label: 'Prestige', value: game.prestige },
    { label: 'Auto', value: countAutomatedBusinesses(game) },
    { label: 'Défis', value: `${game.dailyChallenges.filter((item) => item.claimed).length}/3` },
  ];

  const renderDashboard = () => (
    <>
      <SectionHeader title="Missions" subtitle="Objectifs permanents à valider pour accélérer la progression." />
      {unclaimedMissions.slice(0, 4).map((mission) => {
        const progress = evaluateRequirement(game, mission.type);
        const complete = progress >= mission.target;
        return (
          <View key={mission.id} style={styles.card}>
            <View style={styles.missionHeader}>
              <View>
                <Text style={styles.cardTitle}>{mission.title}</Text>
                <Text style={styles.cardText}>{mission.description}</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{formatCompactNumber(progress)} / {formatCompactNumber(mission.target)}</Text>
              </View>
            </View>
            <View style={styles.rowSpace}>
              <Text style={styles.cardText}>Récompense {formatMoney(mission.rewardCash)} + {mission.rewardXp} XP</Text>
              <AppButton label={complete ? 'Réclamer' : 'En cours'} onPress={() => claimMission(mission.id)} disabled={!complete} />
            </View>
          </View>
        );
      })}

      <SectionHeader title="Défis du jour" subtitle={`Local, réinitialisés le ${game.dailySeedKey}.`} />
      {game.dailyChallenges.map((challenge) => {
        const progress = evaluateDailyChallenge(game, challenge);
        const complete = progress >= challenge.target;
        return (
          <View key={challenge.id} style={styles.card}>
            <View style={styles.missionHeader}>
              <View>
                <Text style={styles.cardTitle}>{challenge.title}</Text>
                <Text style={styles.cardText}>Récompense {formatMoney(challenge.rewardCash)} + {challenge.rewardXp} XP</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{formatCompactNumber(progress)} / {formatCompactNumber(challenge.target)}</Text>
              </View>
            </View>
            <AppButton
              label={challenge.claimed ? 'Réclamé' : complete ? 'Réclamer' : 'En cours'}
              onPress={() => claimDaily(challenge.id)}
              disabled={!complete || challenge.claimed}
            />
          </View>
        );
      })}

      <SectionHeader title="Boosts temporaires" subtitle="Tout est local: aucun serveur, aucun timer distant." />
      <View style={styles.grid}>
        {BOOST_CATALOG.map((boost) => {
          const active = game.boosts.find((item) => item.id === boost.id);
          return (
            <View key={boost.id} style={styles.gridCard}>
              <Text style={styles.cardTitle}>{boost.title}</Text>
              <Text style={styles.cardText}>{boost.description}</Text>
              <Text style={styles.cardStrong}>{formatMoney(boost.cost)}</Text>
              <Text style={styles.cardText}>{active ? `Actif ${formatDuration(active.remainingMs)}` : `Durée ${formatDuration(boost.durationMs)}`}</Text>
              <AppButton label={active ? 'Recharger' : 'Activer'} onPress={() => activateBoost(boost.id)} disabled={game.cash < boost.cost} />
            </View>
          );
        })}
      </View>

      <SectionHeader title="Journal récent" subtitle="Événements internes, offline et locaux." />
      {game.logs.slice(0, 6).map((log) => (
        <View key={log.id} style={[styles.logCard, log.tone === 'positive' && styles.logPositive, log.tone === 'warning' && styles.logWarning, log.tone === 'accent' && styles.logAccent]}>
          <Text style={styles.logText}>{log.text}</Text>
        </View>
      ))}
    </>
  );

  const renderBusinesses = () => (
    <>
      {Object.entries(groupedBusinesses).map(([sector, items]) => (
        <View key={sector}>
          <SectionHeader title={sector} subtitle={`${items.length} businesses dans ce segment.`} />
          {items.map((item) => {
            const state = game.businesses[item.id];
            const buyPrice = Math.round(item.price * (1 + state.owned * 0.28));
            const upgradeCost = Math.round(item.upgradeBaseCost * (1 + state.level * 0.6 + state.owned * 0.15));
            const incomePerSec = ((item.baseIncome * Math.max(1, state.owned)) / item.cycleSeconds) * (state.owned ? 1 + state.level * 0.42 + state.efficiencyBonus + state.reputationBonus * 0.5 + (state.automated ? 0.18 : 0) : 0);
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.mediaRow}>
                  <Image source={IMAGE_SOURCES[item.imageKey]} style={styles.cardImage} />
                  <View style={styles.mediaContent}>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    <Text style={styles.cardText}>{item.description}</Text>
                    <View style={styles.chipRow}>
                      <Text style={styles.chip}>Possédés {state.owned}</Text>
                      <Text style={styles.chip}>Niveau {state.level}</Text>
                      <Text style={styles.chip}>Employés {item.employees * Math.max(1, state.owned)}</Text>
                    </View>
                    <View style={styles.chipRow}>
                      <Text style={styles.chip}>Eff. {(100 * (1 + state.efficiencyBonus)).toFixed(0)}%</Text>
                      <Text style={styles.chip}>Réputation {(100 * (1 + state.reputationBonus)).toFixed(0)}%</Text>
                      <Text style={styles.chip}>{state.automated ? 'Auto ON' : 'Auto OFF'}</Text>
                    </View>
                    <Text style={styles.cardStrong}>≈ {formatMoney(incomePerSec)}/s · cycle {item.cycleSeconds}s</Text>
                  </View>
                </View>
                <View style={styles.buttonRow}>
                  <AppButton label={`Acheter ${formatMoney(buyPrice)}`} onPress={() => buyBusiness(item.id)} disabled={game.cash < buyPrice} />
                  <AppButton label={`Upgrade ${formatMoney(upgradeCost)}`} onPress={() => upgradeBusiness(item.id)} disabled={game.cash < upgradeCost || !state.owned} subtle />
                </View>
                <AppButton
                  label={state.automated ? 'Automatisé' : `Auto ${formatMoney(Math.round(item.upgradeBaseCost * 3.4))}`}
                  onPress={() => automateBusiness(item.id)}
                  disabled={state.automated || !state.owned || state.level < 3 || state.owned < 2 || game.cash < Math.round(item.upgradeBaseCost * 3.4)}
                  subtle
                />
              </View>
            );
          })}
        </View>
      ))}
    </>
  );

  const renderProperties = () => (
    <>
      {Object.entries(groupedProperties).map(([segment, items]) => (
        <View key={segment}>
          <SectionHeader title={segment} subtitle={`${items.length} biens disponibles dans la catégorie.`} />
          {items.map((item) => {
            const state = game.properties[item.id];
            const buyPrice = Math.round(item.price * (1 + state.owned * 0.24));
            const renoCost = Math.round(item.price * (0.08 + state.renovation * 0.04));
            const rentPerSec = state.owned
              ? (item.rent * state.owned * clamp(item.occupancy + (state.security ? 0.02 : 0) + (state.managed ? 0.03 : 0), 0.85, 0.99) * (1 + item.renovationPotential * state.renovation + (state.furnished ? 0.08 : 0)) * (1 - item.maintenance / 1000)) / 18
              : 0;
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.mediaRow}>
                  <Image source={IMAGE_SOURCES[item.imageKey]} style={styles.cardImage} />
                  <View style={styles.mediaContent}>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    <Text style={styles.cardText}>{item.description}</Text>
                    <View style={styles.chipRow}>
                      <Text style={styles.chip}>Rareté {item.rarity}</Text>
                      <Text style={styles.chip}>Possédés {state.owned}</Text>
                      <Text style={styles.chip}>Rénov. {state.renovation}</Text>
                    </View>
                    <View style={styles.chipRow}>
                      <Text style={styles.chip}>Occup. {formatPercent(item.occupancy)}</Text>
                      <Text style={styles.chip}>Gestion {state.managed ? 'Oui' : 'Non'}</Text>
                      <Text style={styles.chip}>Sécurité {state.security ? 'Oui' : 'Non'}</Text>
                    </View>
                    <Text style={styles.cardStrong}>≈ {formatMoney(rentPerSec)}/s · revente {formatMoney(item.resaleBase * Math.max(1, state.owned))}</Text>
                  </View>
                </View>
                <View style={styles.buttonRow}>
                  <AppButton label={`Acheter ${formatMoney(buyPrice)}`} onPress={() => buyProperty(item.id)} disabled={game.cash < buyPrice} />
                  <AppButton label={`Rénover ${formatMoney(renoCost)}`} onPress={() => renovateProperty(item.id)} disabled={game.cash < renoCost || !state.owned} subtle />
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </>
  );

  const renderMarkets = () => (
    <>
      <SectionHeader title="News internes" subtitle="Mouvements locaux simulés sans API externe." />
      <View style={styles.grid}>
        {MARKETS.slice(0, 3).map((asset) => (
          <View key={`headline-${asset.id}`} style={styles.gridCard}>
            <Text style={styles.cardTitle}>{asset.symbol}</Text>
            <Text style={styles.cardText}>{game.markets[asset.id].news}</Text>
            <Text style={styles.cardStrong}>{formatMoney(game.markets[asset.id].price)}</Text>
          </View>
        ))}
      </View>
      <SectionHeader title="Actions" subtitle={`${stocks.length} entreprises fictives locales.`} />
      {stocks.map((asset) => {
        const state = game.markets[asset.id];
        const positive = state.lastChangePct >= 0;
        return (
          <View key={asset.id} style={styles.card}>
            <View style={styles.mediaRow}>
              <Image source={IMAGE_SOURCES[asset.imageKey]} style={styles.marketImage} />
              <View style={styles.mediaContent}>
                <Text style={styles.cardTitle}>{asset.name} · {asset.symbol}</Text>
                <Text style={styles.cardText}>{asset.sector} · rendement div. {(asset.dividendYield * 100).toFixed(1)}%</Text>
                <View style={styles.chipRow}>
                  <Text style={styles.chip}>Prix {formatMoney(state.price)}</Text>
                  <Text style={[styles.chip, positive ? styles.chipPositive : styles.chipNegative]}>
                    {positive ? '+' : ''}{(state.lastChangePct * 100).toFixed(2)}%
                  </Text>
                  <Text style={styles.chip}>Qté {state.quantity}</Text>
                </View>
                <MiniChart history={state.history} positive={positive} />
              </View>
            </View>
            <View style={styles.buttonRow}>
              <AppButton label={`Acheter 1 · ${formatMoney(state.price)}`} onPress={() => buyMarket(asset.id)} disabled={game.cash < state.price} />
              <AppButton label="Vendre 1" onPress={() => sellMarket(asset.id)} disabled={state.quantity < 1} subtle />
            </View>
          </View>
        );
      })}

      <SectionHeader title="Cryptos" subtitle={`${cryptos.length} tokens fictifs à forte volatilité.`} />
      {cryptos.map((asset) => {
        const state = game.markets[asset.id];
        const positive = state.lastChangePct >= 0;
        const blockValue = state.price * 5;
        return (
          <View key={asset.id} style={styles.card}>
            <View style={styles.mediaRow}>
              <Image source={IMAGE_SOURCES[asset.imageKey]} style={styles.marketImage} />
              <View style={styles.mediaContent}>
                <Text style={styles.cardTitle}>{asset.name} · {asset.symbol}</Text>
                <Text style={styles.cardText}>Volatilité locale élevée · packs de 5 unités</Text>
                <View style={styles.chipRow}>
                  <Text style={styles.chip}>Prix {formatMoney(state.price)}</Text>
                  <Text style={[styles.chip, positive ? styles.chipPositive : styles.chipNegative]}>
                    {positive ? '+' : ''}{(state.lastChangePct * 100).toFixed(2)}%
                  </Text>
                  <Text style={styles.chip}>Qté {state.quantity}</Text>
                </View>
                <MiniChart history={state.history} positive={positive} />
              </View>
            </View>
            <View style={styles.buttonRow}>
              <AppButton label={`Acheter 5 · ${formatMoney(blockValue)}`} onPress={() => buyMarket(asset.id)} disabled={game.cash < blockValue} />
              <AppButton label="Vendre 5" onPress={() => sellMarket(asset.id)} disabled={state.quantity < 5} subtle />
            </View>
          </View>
        );
      })}
    </>
  );

  const renderLuxury = () => (
    <>
      {Object.entries(groupedLuxury).map(([category, items]) => (
        <View key={category}>
          <SectionHeader title={category} subtitle={`${items.length} actifs prestige disponibles.`} />
          {items.map((item) => {
            const owned = game.luxuries[item.id]?.owned;
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.mediaRow}>
                  <Image source={IMAGE_SOURCES[item.imageKey]} style={styles.cardImage} />
                  <View style={styles.mediaContent}>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    <Text style={styles.cardText}>{item.description}</Text>
                    <View style={styles.chipRow}>
                      <Text style={styles.chip}>{item.bonusType}</Text>
                      <Text style={styles.chip}>Bonus {typeof item.bonusValue === 'number' && item.bonusValue < 1 ? formatPercent(item.bonusValue) : formatCompactNumber(item.bonusValue)}</Text>
                      <Text style={styles.chip}>{owned ? 'Possédé' : 'Disponible'}</Text>
                    </View>
                    <Text style={styles.cardStrong}>{formatMoney(item.price)}</Text>
                  </View>
                </View>
                <AppButton label={owned ? 'Déjà acquis' : `Acheter ${formatMoney(item.price)}`} onPress={() => buyLuxury(item.id)} disabled={owned || game.cash < item.price} />
              </View>
            );
          })}
        </View>
      ))}
    </>
  );

  const renderProfile = () => (
    <>
      <SectionHeader title="Résumé du profil" subtitle="Toutes les stats clés de ta progression locale." />
      <View style={styles.grid}>
        {achievementList.map((item) => (
          <View key={item.label} style={styles.gridCard}>
            <Text style={styles.metricTitle}>{item.label}</Text>
            <Text style={styles.metricValue}>{item.value}</Text>
            <Text style={styles.metricNote}>Progression en cours</Text>
          </View>
        ))}
      </View>

      <SectionHeader title="Stats longues" subtitle="Idéal pour équilibrer le jeu ou pousser sur GitHub." />
      <View style={styles.card}>
        <View style={styles.profileStatRow}>
          <Text style={styles.cardText}>XP total</Text>
          <Text style={styles.cardStrong}>{formatCompactNumber(game.xp)}</Text>
        </View>
        <View style={styles.profileStatRow}>
          <Text style={styles.cardText}>Missions complétées</Text>
          <Text style={styles.cardStrong}>{completedMissionCount} / {MISSION_DEFS.length}</Text>
        </View>
        <View style={styles.profileStatRow}>
          <Text style={styles.cardText}>Total gagné</Text>
          <Text style={styles.cardStrong}>{formatMoney(game.stats.totalEarned)}</Text>
        </View>
        <View style={styles.profileStatRow}>
          <Text style={styles.cardText}>Total dépensé</Text>
          <Text style={styles.cardStrong}>{formatMoney(game.stats.totalSpent)}</Text>
        </View>
        <View style={styles.profileStatRow}>
          <Text style={styles.cardText}>Plus gros deal</Text>
          <Text style={styles.cardStrong}>{formatMoney(game.stats.biggestDeal)}</Text>
        </View>
        <View style={styles.profileStatRow}>
          <Text style={styles.cardText}>Valeur de marché</Text>
          <Text style={styles.cardStrong}>{formatMoney(marketValue)}</Text>
        </View>
      </View>

      <SectionHeader title="Historique interne" subtitle="Événements récents de la partie." />
      {game.logs.map((log) => (
        <View key={log.id} style={[styles.logCard, log.tone === 'positive' && styles.logPositive, log.tone === 'warning' && styles.logWarning, log.tone === 'accent' && styles.logAccent]}>
          <Text style={styles.logText}>{log.text}</Text>
        </View>
      ))}
    </>
  );

  const renderTabContent = () => {
    switch (game.activeTab) {
      case 'dashboard':
        return renderDashboard();
      case 'business':
        return renderBusinesses();
      case 'realEstate':
        return renderProperties();
      case 'markets':
        return renderMarkets();
      case 'luxury':
        return renderLuxury();
      case 'profile':
        return renderProfile();
      default:
        return renderDashboard();
    }
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.loadingShell}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.loadingTitle}>Empire Ledger</Text>
        <Text style={styles.loadingText}>Chargement de l’économie locale…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Image source={IMAGE_SOURCES.dashboard} style={styles.heroImage} />
          <View style={styles.heroOverlay}>
            <Text style={styles.brand}>Empire Ledger</Text>
            <Text style={styles.heroTitle}>Tycoon mobile offline inspiré du fantasy business sim</Text>
            <Text style={styles.heroSubtitle}>Code original, images locales, économie simulée directement sur le téléphone.</Text>
            <View style={styles.metricsRow}>
              <MetricCard title="Cash" value={formatMoney(game.cash)} note="Liquidités" />
              <MetricCard title="/ seconde" value={formatMoney(passiveIncome)} note="Revenu passif" />
              <MetricCard title="Net worth" value={formatMoney(netWorth)} note="Valeur nette" />
            </View>
            <View style={styles.statRow}>
              <StatPill label="Niveau" value={game.level} accent />
              <StatPill label="Prestige" value={game.prestige} />
              <StatPill label="Boosts" value={game.boosts.length} />
              <StatPill label="Auto" value={countAutomatedBusinesses(game)} />
            </View>
          </View>
        </View>

        <View style={styles.tabRow}>
          {TAB_META.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => changeTab(tab.key)}
              style={({ pressed }) => [
                styles.tabButton,
                game.activeTab === tab.key && styles.tabButtonActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Image source={IMAGE_SOURCES[tab.imageKey]} style={styles.tabIcon} />
              <Text style={[styles.tabText, game.activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>

        <ActionCard game={game} onStartAction={startAction} />

        {renderTabContent()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08101e',
  },
  loadingShell: {
    flex: 1,
    backgroundColor: '#08101e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingTitle: {
    color: '#eef4ff',
    fontSize: 28,
    fontWeight: '800',
  },
  loadingText: {
    color: '#94a6c8',
    marginTop: 12,
    fontSize: 15,
  },
  scrollContent: {
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  hero: {
    backgroundColor: '#0f1930',
    borderRadius: 28,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#233456',
  },
  heroImage: {
    width: '100%',
    height: 260,
  },
  heroOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 18,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(8,16,30,0.34)',
  },
  brand: {
    color: '#9bb3ff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#f3f7ff',
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
    marginTop: 10,
    maxWidth: '92%',
  },
  heroSubtitle: {
    color: '#d1dcf5',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: '95%',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  metricCard: {
    flex: 1,
    backgroundColor: 'rgba(8, 17, 35, 0.74)',
    borderWidth: 1,
    borderColor: 'rgba(143, 171, 255, 0.2)',
    borderRadius: 18,
    padding: 12,
  },
  metricTitle: {
    color: '#8ea5ca',
    fontSize: 12,
    fontWeight: '700',
  },
  metricValue: {
    color: '#f2f6ff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 6,
  },
  metricNote: {
    color: '#8ea5ca',
    fontSize: 12,
    marginTop: 6,
  },
  statRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  statPill: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 31, 0.78)',
    borderColor: '#22304a',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  statPillAccent: {
    borderColor: '#506cff',
    backgroundColor: 'rgba(80, 108, 255, 0.18)',
  },
  statLabel: {
    color: '#94a6c8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statValue: {
    color: '#edf4ff',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 6,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  tabButton: {
    width: '31%',
    minWidth: 104,
    backgroundColor: '#111b30',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#22304a',
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 8,
  },
  tabButtonActive: {
    borderColor: '#506cff',
    backgroundColor: '#172646',
  },
  tabText: {
    color: '#a4b7d6',
    fontWeight: '700',
    fontSize: 12,
  },
  tabTextActive: {
    color: '#f1f5ff',
  },
  tabIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
  },
  actionCard: {
    backgroundColor: '#101a31',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#22334f',
    marginBottom: 20,
    overflow: 'hidden',
  },
  actionImage: {
    width: '100%',
    height: 170,
  },
  actionContent: {
    padding: 16,
    gap: 8,
  },
  actionEyebrow: {
    color: '#92a6ce',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  actionTitle: {
    color: '#f3f7ff',
    fontSize: 22,
    fontWeight: '900',
  },
  actionSubtitle: {
    color: '#b8c6de',
    fontSize: 14,
    lineHeight: 20,
  },
  actionProgressShell: {
    height: 14,
    backgroundColor: '#0a1122',
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#253552',
  },
  actionProgressFill: {
    height: '100%',
    backgroundColor: '#5f7bff',
    borderRadius: 999,
  },
  actionMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 4,
  },
  actionMetaText: {
    color: '#9bb0d7',
    fontSize: 12,
  },
  sectionHeader: {
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: {
    color: '#eef4ff',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: '#8fa4cb',
    fontSize: 13,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#0f1930',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#213250',
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: {
    color: '#f3f7ff',
    fontSize: 17,
    fontWeight: '800',
  },
  cardText: {
    color: '#a9bbda',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  cardStrong: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 8,
  },
  missionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#31486c',
    backgroundColor: '#091120',
  },
  badgeText: {
    color: '#dce7ff',
    fontSize: 12,
    fontWeight: '800',
  },
  button: {
    backgroundColor: '#5e7aff',
    borderRadius: 16,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    flex: 1,
  },
  buttonSubtle: {
    backgroundColor: '#121f39',
    borderColor: '#32496e',
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    transform: [{ scale: 0.985 }],
  },
  buttonText: {
    color: '#f7fbff',
    fontWeight: '800',
    fontSize: 13,
  },
  buttonTextSubtle: {
    color: '#dce7ff',
  },
  rowSpace: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  gridCard: {
    width: '48%',
    backgroundColor: '#0f1930',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#213250',
    padding: 14,
    marginBottom: 2,
  },
  logCard: {
    backgroundColor: '#0c162a',
    borderWidth: 1,
    borderColor: '#213250',
    borderRadius: 18,
    padding: 12,
    marginBottom: 8,
  },
  logPositive: {
    borderColor: '#1e7d57',
    backgroundColor: '#0f221a',
  },
  logWarning: {
    borderColor: '#8b5e1c',
    backgroundColor: '#251c0f',
  },
  logAccent: {
    borderColor: '#4d62ff',
    backgroundColor: '#101a31',
  },
  logText: {
    color: '#eaf1ff',
    fontSize: 13,
    lineHeight: 18,
  },
  mediaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cardImage: {
    width: 110,
    height: 110,
    borderRadius: 18,
  },
  marketImage: {
    width: 84,
    height: 84,
    borderRadius: 18,
  },
  mediaContent: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  chip: {
    color: '#d4e0fb',
    backgroundColor: '#0a1222',
    borderWidth: 1,
    borderColor: '#2a3d60',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    overflow: 'hidden',
  },
  chipPositive: {
    borderColor: '#1e8e61',
    color: '#a7ffd4',
  },
  chipNegative: {
    borderColor: '#9c4759',
    color: '#ffd1db',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 58,
    marginTop: 8,
  },
  chartBarWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  chartBar: {
    borderRadius: 4,
  },
  chartBarPositive: {
    backgroundColor: '#63e3a6',
  },
  chartBarNegative: {
    backgroundColor: '#ff8aa3',
  },
  profileStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
});

export default App;
