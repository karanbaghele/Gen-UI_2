"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  Paperclip,
  TrendingUp,
  ChartColumn,
  Users,
  Check,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/client";
import { readGenerationStream } from "@/lib/client-stream";
import type { Dataset } from "@/lib/domain/schema";
import { suggestDashboardPrompts } from "@/lib/domain/prompt-suggestions";
import { AddData } from "@/components/add-data";
import { ErrorNote } from "@/components/ui";
import type { Session } from "@/components/shell";
import styles from "./prompt-suggestions.module.css";
const suggestionIcons = [TrendingUp, ChartColumn, Users];
export default function HomePage() {
  const router = useRouter();
  const data = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api<{ datasets: Dataset[] }>("/api/datasets"),
  });
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/api/session"),
  });
  const [prompt, setPrompt] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [suggestedFor, setSuggestedFor] = useState<string | null>(null);
  const [addData, setAddData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stages, setStages] = useState<string[]>([]);
  const [mode, setMode] = useState("");
  const abort = useRef<AbortController | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const datasets = data.data?.datasets ?? [];
  const selectedDataset = datasets.find((dataset) => dataset.id === datasetId) ?? datasets[0];
  const selected = selectedDataset?.id ?? "";
  const suggestions = selectedDataset ? suggestDashboardPrompts(selectedDataset) : [];
  const config = session.data?.config;
  const effectiveMode =
    mode || (config?.nvidia ? "nvidia" : config?.ollama ? "ollama" : config?.gemini ? "gemini" : "demo");
  const generate = async () => {
    if (!prompt.trim() || !selected || busy) return;
    setBusy(true);
    setError("");
    setStages([]);
    abort.current = new AbortController();
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: selected,
          prompt: prompt.trim(),
          mode: effectiveMode,
        }),
        signal: abort.current.signal,
      });
      const result = await readGenerationStream<{
        type: "result";
        dashboard: { id: string };
      }>(response, (stage) => setStages((old) => [...old, stage]));
      router.push(`/dashboards/${result.dashboard.id}`);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError")
        setError("Generation cancelled.");
      else setError(e instanceof Error ? e.message : "Unable to generate.");
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };
  return (
    <div className="home">
      <div className="home-intro">
        <div className="eyebrow">A little curiosity goes a long way</div>
        <h1>
          What would you like to
          <br />
          understand from your data?
        </h1>
        <p>Ask a question. Find a pattern. Make your next move clearer.</p>
      </div>
      <div className="composer">
        <label className="sr-only" htmlFor="home-prompt">
          Describe your dashboard
        </label>
        <textarea
          ref={promptRef}
          id="home-prompt"
          placeholder="Show me what’s driving our sales this quarter…"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setSuggestedFor(null);
          }}
          disabled={busy}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              (!e.shiftKey || e.metaKey || e.ctrlKey)
            ) {
              e.preventDefault();
              void generate();
            }
          }}
        />
        <div className={`composer-footer ${styles.composerFooter}`}>
          <select
            className="dataset-select"
            aria-label="Select a dataset"
            value={selected}
            onChange={(e) => {
              if (e.target.value === "__add") {
                setAddData(true);
                return;
              }
              if (suggestedFor && suggestedFor !== e.target.value) {
                setPrompt("");
                setSuggestedFor(null);
              }
              setDatasetId(e.target.value);
            }}
            disabled={busy}
          >
            <option value="">Select your data</option>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name}
              </option>
            ))}
            <option value="__add">＋ Add data or try a sample</option>
          </select>
          <button
            className="icon-button"
            aria-label="Upload or connect data"
            onClick={() => setAddData(true)}
            disabled={busy}
          >
            <Paperclip size={16} />
          </button>
          <span className="spacer" />
          {busy ? (
            <button
              className="button small"
              onClick={() => abort.current?.abort()}
            >
              Cancel
            </button>
          ) : (
            <button
              className="button primary"
              disabled={!selected || !prompt.trim()}
              onClick={() => void generate()}
            >
              Generate
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="row spread" style={{ marginTop: 10, gap: 6 }}>
        <select
          aria-label="Generation provider"
          className="dataset-select"
          style={{ background: "transparent", fontSize: 10, padding: "2px 0" }}
          value={effectiveMode}
          onChange={(e) => setMode(e.target.value)}
          disabled={busy}
        >
          <option value="demo">Demo · deterministic sample planner</option>
          {config?.ollama && <option value="ollama">AI · Local Ollama</option>}
          {config?.gemini && <option value="gemini">AI · Gemini</option>}
          {config?.nvidia && <option value="nvidia">AI · NVIDIA</option>}
        </select>
        <span className="composer-help" style={{ margin: 0 }}>
          Enter to generate · Shift + Enter for a new line
        </span>
      </div>
      {effectiveMode === "demo" && (
        <p style={{ fontSize: 10, marginTop: 8 }}>
          Demo mode uses a limited built-in planner and real calculations.
          Configure NVIDIA, Ollama, or Gemini for AI generation.
        </p>
      )}
      <ErrorNote message={error || data.error?.message} />
      {busy && (
        <div className="card progress-panel" role="status" aria-live="polite">
          <h3 style={{ marginBottom: 12 }}>Making sense of your data</h3>
          {stages.map((stage, i) => (
            <div
              key={`${stage}-${i}`}
              className={`progress-stage ${i === stages.length - 1 ? "current" : "done"}`}
            >
              {i === stages.length - 1 ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              <span>{stage}</span>
            </div>
          ))}
          {stages.length === 0 && (
            <div className="progress-stage">
              <Loader2 className="spin" size={15} />
              Starting your request…
            </div>
          )}
        </div>
      )}
      {!busy && (
        <>
          {selectedDataset ? (
            <section className={styles.section} aria-label="Suggested prompts">
              <div className={styles.heading}>
                <div>
                  <div className="examples-label">Ideas from your data</div>
                  <p>Based on the columns in <strong>{selectedDataset.name}</strong></p>
                </div>
                <span className={styles.count}>{suggestions.length} suggestions</span>
              </div>
              <div className={styles.grid}>
                {suggestions.map((suggestion, index) => {
                  const Icon = suggestionIcons[index];
                  return (
                    <button
                      className={styles.card}
                      key={suggestion.id}
                      onClick={() => {
                        setPrompt(suggestion.prompt);
                        setSuggestedFor(selected);
                        promptRef.current?.focus();
                      }}
                    >
                      <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                      <span className={styles.cardTitle}>{suggestion.label}</span>
                      <span className={styles.preview}>{suggestion.preview}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : (
            <p className={styles.empty}>Add or select data to see suggested prompts.</p>
          )}
          <div className="home-footnote">
            <ShieldCheck size={12} />
            Your numbers come from your data. Every chart has a source.
          </div>
        </>
      )}
      <AddData
        open={addData}
        onOpenChange={setAddData}
        onAdded={(dataset) => {
          if (suggestedFor) {
            setPrompt("");
            setSuggestedFor(null);
          }
          setDatasetId(dataset.id);
        }}
      />
    </div>
  );
}
