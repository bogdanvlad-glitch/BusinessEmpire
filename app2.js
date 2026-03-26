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
