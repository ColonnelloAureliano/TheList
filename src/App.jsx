import { useEffect, useMemo, useState } from "react";

const MODES = {
  short: { label: "Breve", factor: 0.5, description: "Rapido, con il 50% dei confronti completi." },
  long: { label: "Lungo", factor: 0.7, description: "Più accurato, con il 70% dei confronti completi." },
  complete: { label: "Completo", factor: 1, description: "Massima accuratezza con il numero completo di confronti." },
};

function stirlingComparisons(n) {
  if (n <= 1) return 0;
  const log2Factorial = (n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n)) / Math.log(2);
  return Math.max(n - 1, Math.ceil(log2Factorial));
}

function questionCount(n, mode) {
  const maxUniquePairs = (n * (n - 1)) / 2;
  const complete = Math.min(maxUniquePairs, stirlingComparisons(n));
  return Math.min(maxUniquePairs, Math.max(n - 1, Math.ceil(complete * MODES[mode].factor)));
}

function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function makePair(items, ratings, appearances, usedPairs) {
  const candidates = [];
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      if (usedPairs.has(pairKey(a, b))) continue;
      const ratingDistance = Math.abs(ratings[a] - ratings[b]);
      const balancePenalty = appearances[a] + appearances[b];
      candidates.push({
        a,
        b,
        priority: ratingDistance + balancePenalty * 18 + Math.random() * 30,
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((x, y) => x.priority - y.priority);
  return candidates[0];
}

function cleanLists(data) {
  if (!Array.isArray(data) || data.length !== 5) {
    throw new Error("Il file lists.json deve contenere esattamente 5 liste.");
  }
  return data.map((list, index) => {
    const items = [...new Set((list.items || []).map(String).map((x) => x.trim()).filter(Boolean))];
    if (items.length < 2) throw new Error(`La lista ${index + 1} deve contenere almeno 2 elementi.`);
    return {
      id: String(list.id || `lista${index + 1}`),
      name: String(list.name || `LISTA ${index + 1}`),
      items,
    };
  });
}

export default function App() {
  const [lists, setLists] = useState([]);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [mode, setMode] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [wins, setWins] = useState([]);
  const [appearances, setAppearances] = useState([]);
  const [usedPairs, setUsedPairs] = useState(new Set());
  const [pair, setPair] = useState(null);
  const [answered, setAnswered] = useState(0);
  const [target, setTarget] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/lists.json`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Impossibile caricare public/data/lists.json.");
        return response.json();
      })
      .then((data) => setLists(cleanLists(data)))
      .catch((err) => setError(err.message));
  }, []);

  const activeList = selectedIndex === null ? null : lists[selectedIndex];

  const ranking = useMemo(() => {
    if (!activeList) return [];
    return activeList.items
      .map((item, index) => ({ item, index, rating: ratings[index] || 1000, wins: wins[index] || 0 }))
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.item.localeCompare(b.item, "it"));
  }, [activeList, ratings, wins]);

  function selectList(index) {
    setSelectedIndex(index);
    setMode(null);
    setFinished(false);
    setPair(null);
  }

  function start(selectedMode) {
    const count = activeList.items.length;
    const initialRatings = Array(count).fill(1000);
    const initialWins = Array(count).fill(0);
    const initialAppearances = Array(count).fill(0);
    const initialPairs = new Set();
    setMode(selectedMode);
    setRatings(initialRatings);
    setWins(initialWins);
    setAppearances(initialAppearances);
    setUsedPairs(initialPairs);
    setAnswered(0);
    setTarget(questionCount(count, selectedMode));
    setPair(makePair(activeList.items, initialRatings, initialAppearances, initialPairs));
    setFinished(false);
  }

  function vote(winner, loser) {
    const nextRatings = [...ratings];
    const nextWins = [...wins];
    const nextAppearances = [...appearances];
    const expectedWinner = 1 / (1 + 10 ** ((nextRatings[loser] - nextRatings[winner]) / 400));
    const delta = 32 * (1 - expectedWinner);
    nextRatings[winner] += delta;
    nextRatings[loser] -= delta;
    nextWins[winner] += 1;
    nextAppearances[winner] += 1;
    nextAppearances[loser] += 1;

    const nextPairs = new Set(usedPairs);
    nextPairs.add(pairKey(winner, loser));
    const nextAnswered = answered + 1;

    setRatings(nextRatings);
    setWins(nextWins);
    setAppearances(nextAppearances);
    setUsedPairs(nextPairs);
    setAnswered(nextAnswered);

    if (nextAnswered >= target) {
      setFinished(true);
      setPair(null);
      return;
    }

    const nextPair = makePair(activeList.items, nextRatings, nextAppearances, nextPairs);
    if (!nextPair) {
      setFinished(true);
      setPair(null);
    } else {
      setPair(nextPair);
    }
  }

  function resetAll() {
    setSelectedIndex(null);
    setMode(null);
    setFinished(false);
    setPair(null);
    setAnswered(0);
  }

  function exportCsv() {
    const rows = [["Posizione", "Elemento"], ...ranking.map((entry, index) => [index + 1, entry.item])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeList.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-classifica.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const progress = target ? Math.round((answered / target) * 100) : 0;

  if (error) {
    return <main className="shell"><section className="error"><h1>Errore di configurazione</h1><p>{error}</p><p>Controlla il file <code>public/data/lists.json</code>.</p></section></main>;
  }

  if (!lists.length) return <main className="shell"><p className="loading">Caricamento liste...</p></main>;

  return (
    <main className="shell">
      <header className="header">
        <div><p className="eyebrow">Decision helper</p><h1>Confronta. Scegli. Ordina.</h1><p className="subtitle">Confronta due alternative alla volta e costruisci la tua classifica personale.</p></div>
        {selectedIndex !== null && <button className="button secondary compact" onClick={resetAll}>Ricomincia</button>}
      </header>

      <nav className="list-tabs" aria-label="Selezione lista">
        {lists.map((list, index) => (
          <button key={list.id} className={`list-tab ${selectedIndex === index ? "active" : ""}`} onClick={() => selectList(index)}>
            <span>LISTA {index + 1}</span><strong>{list.name}</strong><small>{list.items.length} elementi</small>
          </button>
        ))}
      </nav>

      {selectedIndex === null && <section className="empty-card"><h2>Scegli una lista</h2><p>Seleziona uno dei cinque pulsanti qui sopra per iniziare.</p></section>}

      {activeList && !mode && (
        <section>
          <div className="section-heading"><p className="eyebrow">{activeList.name}</p><h2>Scegli la durata</h2></div>
          <div className="mode-grid">
            {Object.entries(MODES).map(([id, data]) => (
              <button className="mode-card" key={id} onClick={() => start(id)}>
                <span className="mode-label">{data.label}</span><span className="mode-percent">{Math.round(data.factor * 100)}%</span>
                <p>{data.description}</p><strong>{questionCount(activeList.items.length, id)} domande</strong>
              </button>
            ))}
          </div>
        </section>
      )}

      {activeList && mode && !finished && pair && (
        <section className="quiz-card">
          <div className="progress-row"><span>Domanda {answered + 1} di {target}</span><strong>{progress}%</strong></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          <p className="eyebrow centered">{activeList.name}</p><h2 className="question">Quale preferisci?</h2>
          <div className="choice-grid">
            <button className="choice" onClick={() => vote(pair.a, pair.b)}>{activeList.items[pair.a]}</button>
            <span className="or">OPPURE</span>
            <button className="choice" onClick={() => vote(pair.b, pair.a)}>{activeList.items[pair.b]}</button>
          </div>
        </section>
      )}

      {activeList && finished && (
        <section className="results">
          <div className="section-heading"><p className="eyebrow">Risultato finale</p><h2>{activeList.name}</h2></div>
          <ol className="ranking">
            {ranking.map((entry, index) => <li key={entry.index} className={index === 0 ? "winner" : ""}><span>{index + 1}</span><strong>{entry.item}</strong>{index === 0 && <small>★</small>}</li>)}
          </ol>
          <div className="actions"><button className="button primary" onClick={() => start(mode)}>Ripeti</button><button className="button secondary" onClick={() => setMode(null)}>Cambia modalità</button><button className="button secondary" onClick={exportCsv}>Esporta CSV</button></div>
        </section>
      )}
    </main>
  );
}
