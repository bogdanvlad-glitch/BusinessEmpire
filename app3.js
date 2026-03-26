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
