import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, chatStream, type ChatContent, type ChatContentPart, type ChatMessage, type Dataset, type ToolDefinition, type ToolUsageItem } from "../lib/api";
import { PageSection } from "../components/PageSection";
import { useToast } from "../components/Toast";
import { MediaPicker, type PickedMedia } from "../components/MediaPicker";
import { applyMediaUrlCases } from "../lib/mediaUrlCases";

// ── Types ────────────────────────────────────────────────────────────────────

// Client-side extension — toolUsage is never sent to the API
interface StoredMessage extends ChatMessage {
    toolUsage?: ToolUsageItem[];
}

interface Alias {
    name: string;   // e.g. "subreddit"
    tool: string;   // e.g. "search_subreddit"
    param: string;  // e.g. "subreddit"
}

interface AutocompleteState {
    query: string;
    matches: Alias[];
    selectedIndex: number;
}

interface ActiveTool {
    name: string;
    args: Record<string, unknown>;
    done: boolean;
}

interface PendingUpload {
    name: string;
    file: File;
    previewUrl: string;
}

interface PendingPickedMedia {
    name: string;
    url: string;
}

// ── Persistence ──────────────────────────────────────────────────────────────

const MSG_KEY   = "chat_messages";
const ALIAS_KEY = "chat_aliases";
const BUILTIN_ALIASES: Alias[] = [
    { name: "download", tool: "yt_dlp_download", param: "url" },
];
const BUILTIN_ALIAS_NAMES = new Set(BUILTIN_ALIASES.map(a => a.name.toLowerCase()));

const DEFAULT_MESSAGES: StoredMessage[] = [
    { role: "assistant", content: "Hello! I'm your AI assistant. How can I help you today?" },
];

function sanitizeStoredContent(content: ChatContent): ChatContent {
    if (typeof content === "string") return content;
    const sanitized: ChatContentPart[] = [];
    for (const part of content) {
        if (part.type === "image_url" && part.image_url.url.startsWith("data:")) {
            sanitized.push({ type: "text", text: "[uploaded image omitted from saved chat history]" });
            continue;
        }
        sanitized.push(part);
    }
    return sanitized;
}

function sanitizeStoredMessages(messages: StoredMessage[]): StoredMessage[] {
    return messages.map((message) => ({
        ...message,
        content: sanitizeStoredContent(message.content),
    }));
}

function loadMessages(): StoredMessage[] {
    try {
        const raw = sessionStorage.getItem(MSG_KEY);
        if (raw) return sanitizeStoredMessages(JSON.parse(raw) as StoredMessage[]);
    } catch { /* ignore */ }
    return DEFAULT_MESSAGES;
}

// ── Tool usage disclosure ─────────────────────────────────────────────────────

function ToolUsageDisclosure({ toolUsage }: { toolUsage: ToolUsageItem[] }) {
    const [expanded, setExpanded] = useState(false);
    if (!toolUsage.length) return null;
    return (
        <div className="tool-usage">
            <button className="tool-usage-toggle" onClick={() => setExpanded(v => !v)}>
                <span className="tool-usage-chevron">{expanded ? "▾" : "▸"}</span>
                {toolUsage.length} tool{toolUsage.length > 1 ? "s" : ""} used
            </button>
            {expanded && (
                <div className="tool-usage-list">
                    {toolUsage.map((t, i) => (
                        <div key={i} className="tool-usage-item">
                            <div className="tool-usage-name">{t.name}</div>
                            <pre className="tool-usage-args">
                                {JSON.stringify(t.arguments, null, 2)}
                            </pre>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Loading bubble ────────────────────────────────────────────────────────────

function LoadingBubble({ tools }: { tools: ActiveTool[] }) {
    const running = tools.filter(t => !t.done);
    const currentTool = running[running.length - 1];

    return (
        <div className="chat-bubble-row assistant">
            <div className="chat-avatar">AI</div>
            <div className="chat-bubble loading">
                <div className="loading-status">
                    <div className="typing-indicator"><span /><span /><span /></div>
                    <div className="loading-status-detail">
                        <span className="loading-status-text">
                            {currentTool ? `Calling ${currentTool.name}…` : "Thinking…"}
                        </span>
                        {tools.length > 0 && (
                            <div className="loading-tool-history">
                                {tools.map((t, i) => (
                                    <span key={i} className={`loading-tool-chip${t.done ? " done" : ""}`}>
                                        {t.done ? "✓" : "⟳"} {t.name}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function loadAliases(): Alias[] {
    try {
        const raw = localStorage.getItem(ALIAS_KEY);
        if (raw) return JSON.parse(raw) as Alias[];
    } catch { /* ignore */ }
    return [];
}

// ── Alias message processing ──────────────────────────────────────────────────

function getAvailableAliases(aliases: Alias[]): Alias[] {
    return [
        ...BUILTIN_ALIASES,
        ...aliases.filter(a => !BUILTIN_ALIAS_NAMES.has(a.name.toLowerCase())),
    ];
}

function parseDownloadShortcut(content: string): { url: string } | null {
    const match = content.match(/^@download(?:\s+([\s\S]*))?$/i);
    if (!match) return null;
    return { url: (match[1] ?? "").trim() };
}

function processHistoryMessage(content: string, aliases: Alias[]): string {
    const downloadShortcut = parseDownloadShortcut(content);
    if (downloadShortcut) {
        return downloadShortcut.url
            ? `Downloaded media from: ${downloadShortcut.url}`
            : "Requested a media download without a URL.";
    }
    return processAliasMessage(content, aliases);
}

function processAliasMessage(content: string, aliases: Alias[]): string {
    const match = content.match(/^@(\w+)(?:\s+([\s\S]*))?$/);
    if (!match) return content;
    const [, name, args = ""] = match;
    const alias = aliases.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (!alias || !args.trim()) return content;
    return `Call the ${alias.tool} tool. Set the "${alias.param}" parameter to: ${args.trim()}`;
}

function escapeMarkdownInline(value: string): string {
    return value.replace(/[\\`*_{}\[\]()#+\-.!|]/g, "\\$&");
}

function contentToMarkdown(content: ChatContent): string {
    if (typeof content === "string") return content;
    return content
        .map((part) => {
            if (part.type === "text") return part.text;
            if (part.type === "image_url") return `![uploaded image](${part.image_url.url})`;
            return "";
        })
        .filter(Boolean)
        .join("\n\n");
}

function processHistoryContent(content: ChatContent, aliases: Alias[]): ChatContent {
    if (typeof content === "string") {
        return processHistoryMessage(content, aliases);
    }
    return content.map((part) => {
        if (part.type !== "text") return part;
        return { ...part, text: processHistoryMessage(part.text, aliases) };
    });
}

function prepareHistoryContent(content: ChatContent, aliases: Alias[]): ChatContent {
    const processed = processHistoryContent(content, aliases);
    if (typeof processed === "string") return processed;
    return processed.flatMap((part): ChatContentPart[] => {
        if (part.type === "text") return [part];
        return [{ type: "text", text: "[previous uploaded image omitted]" }];
    });
}

function buildMultimodalContent(text: string, imageUrl: string | null): ChatContent {
    if (!imageUrl) return text;
    const parts: ChatContentPart[] = [
        { type: "text", text: text || "Please analyze this image." },
        { type: "image_url", image_url: { url: imageUrl } },
    ];
    return parts;
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                resolve(reader.result);
            } else {
                reject(new Error("Failed to read image."));
            }
        };
        reader.onerror = () => reject(new Error("Failed to read image."));
        reader.readAsDataURL(file);
    });
}

function isImageMedia(filename: string, mediaType?: string): boolean {
    if (mediaType === "image") return true;
    return /\.(png|jpe?g|webp|bmp|gif)$/i.test(filename);
}

function mediaPreviewMarkdown(url: string, title: string, filename: string, mediaType?: string): string {
    const safeTitle = escapeMarkdownInline(title || filename);
    if (isImageMedia(filename, mediaType)) {
        return `![${safeTitle}](${url})`;
    }
    return `[video:${safeTitle}](${url})`;
}

function reactNodeText(node: ReactNode): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(reactNodeText).join("");
    return "";
}

// ── AliasModal ────────────────────────────────────────────────────────────────

function AliasModal({
    aliases,
    onAdd,
    onDelete,
    onClose,
}: {
    aliases: Alias[];
    onAdd: (a: Alias) => void;
    onDelete: (name: string) => void;
    onClose: () => void;
}) {
    const [tools, setTools]             = useState<ToolDefinition[]>([]);
    const [name, setName]               = useState("");
    const [selectedTool, setSelectedTool] = useState("");
    const [selectedParam, setSelectedParam] = useState("");
    const [error, setError]             = useState("");
    const [isLoadingTools, setIsLoadingTools] = useState(true);

    useEffect(() => {
        let active = true;
        setIsLoadingTools(true);
        api.getTools()
            .then((toolDefs) => {
                if (!active) return;
                setTools([...toolDefs].sort((a, b) => a.function.name.localeCompare(b.function.name)));
                setError("");
            })
            .catch((err) => {
                console.error(err);
                if (active) setError(err instanceof Error ? err.message : "Failed to load tools.");
            })
            .finally(() => {
                if (active) setIsLoadingTools(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const toolDef = tools.find(t => t.function.name === selectedTool);
    const requiredParams = toolDef?.function.parameters.required ?? [];
    const allParams = toolDef ? Object.keys(toolDef.function.parameters.properties) : [];

    const handleToolChange = (toolName: string) => {
        setSelectedTool(toolName);
        const def = tools.find(t => t.function.name === toolName);
        setSelectedParam(def?.function.parameters.required[0] ?? "");
    };

    const handleAdd = () => {
        const trimmed = name.trim().replace(/\s/g, "");
        if (!trimmed) { setError("Alias name is required."); return; }
        if (!selectedTool) { setError("Select a tool."); return; }
        if (!selectedParam) { setError("Select a parameter."); return; }
        if (BUILTIN_ALIAS_NAMES.has(trimmed.toLowerCase())) {
            setError(`@${trimmed} is a built-in shortcut.`); return;
        }
        if (aliases.some(a => a.name.toLowerCase() === trimmed.toLowerCase())) {
            setError(`@${trimmed} already exists.`); return;
        }
        onAdd({ name: trimmed, tool: selectedTool, param: selectedParam });
        setName("");
        setSelectedTool("");
        setSelectedParam("");
        setError("");
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-box alias-modal-box" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <span className="eyebrow">Chat</span>
                    <h3>Manage Aliases</h3>
                </div>

                <div className="alias-list">
                    {aliases.length === 0 && (
                        <p className="alias-empty">No aliases yet. Add one below.</p>
                    )}
                    {aliases.map(a => (
                        <div key={a.name} className="alias-item">
                            <code className="alias-tag">@{a.name}</code>
                            <span className="alias-mapping">
                                → {a.tool}
                                <span className="alias-param">({a.param}=…)</span>
                            </span>
                            <button
                                className="alias-delete-btn"
                                onClick={() => onDelete(a.name)}
                                title="Remove alias"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>

                <div className="alias-form">
                    <p className="alias-form-title">Add alias</p>
                    <div className="alias-form-row">
                        <div className="modal-field">
                            <label className="modal-label">Alias name</label>
                            <input
                                type="text"
                                placeholder="e.g. subreddit"
                                value={name}
                                onChange={e => { setName(e.target.value); setError(""); }}
                                onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-label">Tool</label>
                            <select value={selectedTool} onChange={e => handleToolChange(e.target.value)} disabled={isLoadingTools}>
                                <option value="">{isLoadingTools ? "Loading tools…" : "Select…"}</option>
                                {tools.map(t => (
                                    <option key={t.function.name} value={t.function.name}>
                                        {t.function.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="modal-field">
                            <label className="modal-label">Maps to param</label>
                            <select
                                value={selectedParam}
                                onChange={e => setSelectedParam(e.target.value)}
                                disabled={!selectedTool}
                            >
                                <option value="">Select…</option>
                                {allParams.map(p => (
                                    <option key={p} value={p}>
                                        {p}{requiredParams.includes(p) ? "" : " (optional)"}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    {!isLoadingTools && tools.length > 0 ? (
                        <p className="alias-empty">Loaded {tools.length} tools.</p>
                    ) : null}
                    {error && <p className="alias-error">{error}</p>}
                    <button
                        className="primary-button"
                        style={{ alignSelf: "flex-start" }}
                        onClick={handleAdd}
                        disabled={!name.trim() || !selectedTool || !selectedParam}
                    >
                        Add Alias
                    </button>
                </div>

                <div className="modal-actions">
                    <button className="secondary-button" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
}

// ── ChatCarousel ──────────────────────────────────────────────────────────────

function ChatCarousel({
    images,
    onDownload,
    onAddToDataset,
}: {
    images: { src: string; alt: string }[];
    onDownload: (url: string) => void;
    onAddToDataset: (url: string) => void;
}) {
    const [index, setIndex] = useState(0);
    const current = images[index];

    return (
        <div className="chat-carousel">
            <div className="chat-image-wrap">
                <img
                    src={current.src}
                    alt={current.alt}
                    className="chat-embedded-image"
                    loading="lazy"
                    onClick={() => window.open(current.src, "_blank")}
                />
                <div className="chat-image-actions">
                    <button className="chat-action-btn" onClick={(e) => { e.stopPropagation(); onDownload(current.src); }}>
                        Download
                    </button>
                    <button className="chat-action-btn" onClick={(e) => { e.stopPropagation(); onAddToDataset(current.src); }}>
                        Add to Dataset
                    </button>
                </div>
                <button
                    className="chat-carousel-arrow prev"
                    onClick={(e) => { e.stopPropagation(); setIndex((index - 1 + images.length) % images.length); }}
                    aria-label="Previous image"
                >←</button>
                <button
                    className="chat-carousel-arrow next"
                    onClick={(e) => { e.stopPropagation(); setIndex((index + 1) % images.length); }}
                    aria-label="Next image"
                >→</button>
            </div>
            <div className="chat-carousel-counter">
                {images.map((_, i) => (
                    <button
                        key={i}
                        className={`chat-carousel-dot${i === index ? " active" : ""}`}
                        onClick={() => setIndex(i)}
                        aria-label={`Image ${i + 1}`}
                    />
                ))}
            </div>
        </div>
    );
}

// ── Single image with actions ─────────────────────────────────────────────────

function ChatImage({
    src,
    alt,
    onDownload,
    onAddToDataset,
}: {
    src: string;
    alt: string;
    onDownload: (url: string) => void;
    onAddToDataset: (url: string) => void;
}) {
    return (
        <div className="chat-image-wrap">
            <img
                src={src}
                alt={alt}
                className="chat-embedded-image"
                loading="lazy"
                onClick={() => window.open(src, "_blank")}
            />
            <div className="chat-image-actions">
                <button className="chat-action-btn" onClick={(e) => { e.stopPropagation(); onDownload(src); }}>
                    Download
                </button>
                <button className="chat-action-btn" onClick={(e) => { e.stopPropagation(); onAddToDataset(src); }}>
                    Add to Dataset
                </button>
            </div>
        </div>
    );
}

// ── Single video with actions ─────────────────────────────────────────────────

function ChatVideo({
    src,
    title,
    onDownload,
}: {
    src: string;
    title: string;
    onDownload: (url: string) => void;
}) {
    return (
        <div className="chat-video-wrap">
            <video
                src={src}
                className="chat-embedded-video"
                controls
                preload="metadata"
            />
            <div className="chat-video-actions">
                <button className="chat-action-btn" onClick={() => onDownload(src)}>
                    Download
                </button>
                <button className="chat-action-btn" onClick={() => window.open(src, "_blank")}>
                    Open
                </button>
            </div>
            <div className="chat-video-title">{title}</div>
        </div>
    );
}

// ── ChatBubbleContent ─────────────────────────────────────────────────────────

function ChatBubbleContent({
    content,
    onDownload,
    onAddToDataset,
}: {
    content: string;
    onDownload: (url: string) => void;
    onAddToDataset: (url: string) => void;
}) {
    return (
        <div className="chat-bubble-content">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    // Override <p> to detect image-only paragraphs and render
                    // single images or carousels instead of plain <p> tags.
                    p({ children, node }) {
                        if (node) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const kids = (node as any).children as any[];
                            const imgNodes = kids.filter(
                                (c: any) => c.type === "element" && c.tagName === "img"
                            );
                            const linkNodes = kids.filter(
                                (c: any) => c.type === "element" && c.tagName === "a"
                            );
                            const hasOnlyImages = kids.every(
                                (c: any) =>
                                    (c.type === "element" && c.tagName === "img") ||
                                    (c.type === "text" && c.value.trim() === "")
                            );
                            const hasOnlyLinks = kids.every(
                                (c: any) =>
                                    (c.type === "element" && c.tagName === "a") ||
                                    (c.type === "text" && c.value.trim() === "")
                            );

                            if (hasOnlyImages && imgNodes.length >= 1) {
                                const images = imgNodes.map((n: any) => ({
                                    src: String(n.properties?.src ?? ""),
                                    alt: String(n.properties?.alt ?? ""),
                                }));

                                if (images.length === 1) {
                                    return <ChatImage src={images[0].src} alt={images[0].alt} onDownload={onDownload} onAddToDataset={onAddToDataset} />;
                                }
                                return <ChatCarousel images={images} onDownload={onDownload} onAddToDataset={onAddToDataset} />;
                            }

                            if (hasOnlyLinks && linkNodes.length === 1) {
                                const link = linkNodes[0];
                                const linkText = (link.children ?? [])
                                    .map((child: any) => child.type === "text" ? String(child.value ?? "") : "")
                                    .join("");
                                if (linkText.toLowerCase().startsWith("video:")) {
                                    return (
                                        <ChatVideo
                                            src={String(link.properties?.href ?? "")}
                                            title={linkText.slice("video:".length).trim() || "Downloaded video"}
                                            onDownload={onDownload}
                                        />
                                    );
                                }
                            }
                        }
                        return <p>{children}</p>;
                    },
                    // Fallback for images in mixed-content paragraphs (not caught by the p override)
                    img({ src, alt }) {
                        if (!src) return null;
                        return (
                            <span className="chat-image-wrap">
                                <img
                                    src={src}
                                    alt={alt ?? ""}
                                    className="chat-embedded-image"
                                    loading="lazy"
                                    onClick={() => window.open(src, "_blank")}
                                />
                                <span className="chat-image-actions">
                                    <button className="chat-action-btn" onClick={(e) => { e.stopPropagation(); onDownload(src); }}>Download</button>
                                    <button className="chat-action-btn" onClick={(e) => { e.stopPropagation(); onAddToDataset(src); }}>Add to Dataset</button>
                                </span>
                            </span>
                        );
                    },
                    a({ href, children }) {
                        const text = reactNodeText(children);
                        if (href && text.toLowerCase().startsWith("video:")) {
                            return <ChatVideo src={href} title={text.slice("video:".length).trim() || "Downloaded video"} onDownload={onDownload} />;
                        }
                        return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

// ── ChatPage ──────────────────────────────────────────────────────────────────

export function ChatPage() {
    const toast = useToast();

    const [messages, setMessages]       = useState<StoredMessage[]>(loadMessages);
    const [input, setInput]             = useState("");
    const [isLoading, setIsLoading]     = useState(false);
    const [activeTools, setActiveTools] = useState<ActiveTool[]>([]);
    const [streamingContent, setStreamingContent] = useState<string | null>(null);
    const [aliases, setAliases]         = useState<Alias[]>(loadAliases);
    const [showAliasModal, setShowAliasModal] = useState(false);
    const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
    const [pendingPickedMedia, setPendingPickedMedia] = useState<PendingPickedMedia | null>(null);
    const [showMediaPicker, setShowMediaPicker] = useState(false);

    const [datasets, setDatasets]       = useState<Dataset[]>([]);
    const [showDatasetModal, setShowDatasetModal] = useState(false);
    const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);

    const scrollRef            = useRef<HTMLDivElement>(null);
    const textareaRef          = useRef<HTMLTextAreaElement>(null);
    const uploadInputRef       = useRef<HTMLInputElement>(null);
    const streamingContentRef  = useRef<string>("");

    // Persist messages
    useEffect(() => {
        sessionStorage.setItem(MSG_KEY, JSON.stringify(messages));
    }, [messages]);

    // Persist aliases
    useEffect(() => {
        localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases));
    }, [aliases]);

    // Scroll to bottom on new message or streaming content
    const scrollToBottom = (smooth = false) => {
        const el = scrollRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (nearBottom) {
            el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
        }
    };

    useEffect(() => { scrollToBottom(true); }, [messages]);
    useEffect(() => { scrollToBottom(); }, [streamingContent]);

    // Fetch datasets once
    useEffect(() => {
        api.getDatasets()
            .then(setDatasets)
            .catch(err => console.error("Failed to fetch datasets", err));
    }, []);

    // ── Textarea helpers ──

    const resizeTextarea = () => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setInput(value);
        resizeTextarea();

        // Detect @alias typing before the cursor
        const cursor = e.target.selectionStart ?? value.length;
        const before = value.slice(0, cursor);
        const atMatch = before.match(/@(\w*)$/);

        if (atMatch) {
            const query = atMatch[1].toLowerCase();
            const matches = getAvailableAliases(aliases).filter(a => a.name.toLowerCase().startsWith(query));
            setAutocomplete(matches.length > 0 ? { query, matches, selectedIndex: 0 } : null);
        } else {
            setAutocomplete(null);
        }
    };

    const applyAutocomplete = (alias: Alias) => {
        const cursor = textareaRef.current?.selectionStart ?? input.length;
        const before = input.slice(0, cursor);
        const atIndex = before.lastIndexOf("@");
        const newText = input.slice(0, atIndex) + `@${alias.name} ` + input.slice(cursor);
        setInput(newText);
        setAutocomplete(null);
        setTimeout(() => {
            if (textareaRef.current) {
                const pos = atIndex + alias.name.length + 2;
                textareaRef.current.focus();
                textareaRef.current.setSelectionRange(pos, pos);
            }
        }, 0);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (autocomplete) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setAutocomplete(prev => prev
                    ? { ...prev, selectedIndex: Math.min(prev.selectedIndex + 1, prev.matches.length - 1) }
                    : prev);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setAutocomplete(prev => prev
                    ? { ...prev, selectedIndex: Math.max(prev.selectedIndex - 1, 0) }
                    : prev);
                return;
            }
            if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                applyAutocomplete(autocomplete.matches[autocomplete.selectedIndex]);
                return;
            }
            if (e.key === "Escape") {
                setAutocomplete(null);
                return;
            }
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        }
    };

    const handleUploadMedia = (file: File) => {
        if (!file.type.startsWith("image/")) {
            toast.error("Only image uploads are supported for chat right now.");
            return;
        }
        setPendingUpload((previous) => {
            if (previous) URL.revokeObjectURL(previous.previewUrl);
            return { name: file.name, file, previewUrl: URL.createObjectURL(file) };
        });
        setShowAttachMenu(false);
    };

    const handlePickMedia = (item: PickedMedia) => {
        if (item.mediaType !== "image") {
            toast.error("Chat vision currently accepts images only.");
            return;
        }
        setPendingPickedMedia({ name: item.title || item.filename, url: item.url });
        setShowMediaPicker(false);
        setShowAttachMenu(false);
    };

    // ── Send ──

    const handleSend = async () => {
        if ((!input.trim() && !pendingUpload && !pendingPickedMedia) || isLoading) return;

        const rawContent = input.trim();
        const downloadShortcut = parseDownloadShortcut(rawContent);

        if (downloadShortcut && !pendingUpload && !pendingPickedMedia) {
            setMessages(prev => [...prev, { role: "user", content: rawContent }]);
            setInput("");
            setAutocomplete(null);
            if (textareaRef.current) textareaRef.current.style.height = "auto";
            setIsLoading(true);
            setActiveTools([{ name: "yt_dlp_download", args: { url: downloadShortcut.url }, done: false }]);
            setStreamingContent(null);
            streamingContentRef.current = "";

            if (!downloadShortcut.url) {
                const content = "Provide a URL after `@download`, for example `@download https://example.com/video`.";
                toast.error("Download URL is required.");
                setMessages(prev => [...prev, { role: "assistant", content, toolUsage: [] }]);
                setActiveTools([]);
                setIsLoading(false);
                return;
            }

            const url = applyMediaUrlCases(downloadShortcut.url);
            try {
                toast.info("Queued media download...");
                const job = await api.createMediaDownloadJob(url);
                const caseNote = url !== downloadShortcut.url
                    ? `\n\nApplied URL case before downloading:\n\`${url}\``
                    : "";
                setMessages(prev => [...prev, {
                    role: "assistant",
                    content: `Queued download job \`${job.job_id}\`. Track progress in the global Jobs drawer.${caseNote}`,
                    toolUsage: [{ name: "yt_dlp_download", arguments: { url } }],
                }]);
                toast.success("Download queued.");
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setMessages(prev => [...prev, {
                    role: "assistant",
                    content: `Download failed: ${message}`,
                    toolUsage: [{ name: "yt_dlp_download", arguments: { url } }],
                }]);
                toast.error(`Download failed: ${message}`);
            } finally {
                setActiveTools([]);
                setIsLoading(false);
            }
            return;
        }

        const apiContent = processAliasMessage(rawContent, aliases);
        let uploadDataUrl: string | null = null;
        if (pendingUpload) {
            try {
                const uploaded = await api.uploadChatMedia(pendingUpload.file);
                uploadDataUrl = uploaded.url;
            } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to upload image.");
                return;
            }
        }
        const imageUrl = uploadDataUrl ?? pendingPickedMedia?.url ?? null;
        const outgoingContent = buildMultimodalContent(apiContent, imageUrl);
        const visibleContent = buildMultimodalContent(rawContent || apiContent, pendingUpload?.previewUrl ?? pendingPickedMedia?.url ?? null);

        setMessages(prev => [...prev, { role: "user", content: visibleContent }]);
        setInput("");
        setPendingUpload(null);
        setPendingPickedMedia(null);
        setShowAttachMenu(false);
        setAutocomplete(null);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        setIsLoading(true);
        setActiveTools([]);
        setStreamingContent(null);
        streamingContentRef.current = "";

        const apiHistory: ChatMessage[] = [
            ...messages.map(({ role, content }) =>
                role === "user"
                    ? { role, content: prepareHistoryContent(content, aliases) }
                    : { role, content }
            ),
            { role: "user", content: outgoingContent },
        ];

        let receivedDone = false;

        try {
            await chatStream({ messages: apiHistory }, (event) => {
                if (event.type === "tool_start") {
                    setActiveTools(prev => [...prev, { name: event.name, args: event.arguments, done: false }]);
                } else if (event.type === "tool_end") {
                    setActiveTools(prev =>
                        prev.map(t => (!t.done && t.name === event.name) ? { ...t, done: true } : t)
                    );
                } else if (event.type === "content") {
                    streamingContentRef.current += event.text;
                    setStreamingContent(streamingContentRef.current);
                } else if (event.type === "done") {
                    receivedDone = true;
                    const content = streamingContentRef.current;
                    streamingContentRef.current = "";
                    setMessages(prev => [...prev, {
                        role: "assistant",
                        content,
                        toolUsage: event.tool_usage ?? [],
                    }]);
                    setStreamingContent(null);
                    setActiveTools([]);
                    setIsLoading(false);
                } else if (event.type === "error") {
                    toast.error(event.message);
                }
            });
        } catch (err) {
            console.error(err);
            toast.error(err instanceof Error ? err.message : "Failed to get AI response.");
        } finally {
            if (!receivedDone) {
                const content = streamingContentRef.current;
                streamingContentRef.current = "";
                if (content) {
                    setMessages(prev => [...prev, { role: "assistant", content, toolUsage: [] }]);
                }
                setStreamingContent(null);
                setActiveTools([]);
                setIsLoading(false);
            }
        }
    };

    // ── Alias management ──

    const handleAddAlias = (a: Alias) => setAliases(prev => [...prev, a]);
    const handleDeleteAlias = (name: string) => setAliases(prev => prev.filter(a => a.name !== name));

    // ── Clear ──

    const handleClear = () => {
        sessionStorage.removeItem(MSG_KEY);
        setMessages([...DEFAULT_MESSAGES]);
    };

    // ── Image actions ──

    const handleDownload = async (url: string) => {
        try {
            toast.info("Downloading media...");
            await api.downloadUrl(url);
            toast.success("Downloaded to uploads/");
        } catch (err) {
            toast.error("Download failed: " + (err instanceof Error ? err.message : String(err)));
        }
    };

    const handleAddToDataset = (url: string) => {
        setPendingImageUrl(url);
        setShowDatasetModal(true);
    };

    const confirmAddToDataset = async (datasetId: number) => {
        if (!pendingImageUrl) return;
        try {
            toast.info("Adding to dataset...");
            await api.downloadUrl(pendingImageUrl, datasetId);
            toast.success("Added to dataset successfully");
            setShowDatasetModal(false);
        } catch (err) {
            toast.error("Failed to add to dataset: " + (err instanceof Error ? err.message : String(err)));
        }
    };

    // ── Render ──

    return (
        <div className="page-stack chat-page">
            <PageSection
                eyebrow="Assistant"
                title="AI Chat"
                actions={
                    <>
                        <button className="chat-clear-btn" onClick={() => setShowAliasModal(true)}>
                            Aliases{aliases.length > 0 ? ` (${aliases.length})` : ""}
                        </button>
                        <button className="chat-clear-btn" onClick={handleClear}>
                            Clear
                        </button>
                    </>
                }
            >
                <div className="chat-container">
                    <div className="chat-messages" ref={scrollRef}>
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`chat-bubble-row ${msg.role}`}>
                                <div className="chat-avatar">{msg.role === "user" ? "U" : "AI"}</div>
                                <div className="chat-bubble">
                                    <ChatBubbleContent
                                        content={contentToMarkdown(msg.content)}
                                        onDownload={handleDownload}
                                        onAddToDataset={handleAddToDataset}
                                    />
                                    {msg.toolUsage && msg.toolUsage.length > 0 && (
                                        <ToolUsageDisclosure toolUsage={msg.toolUsage} />
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* Streaming: show partial content as it arrives */}
                        {streamingContent !== null && (
                            <div className="chat-bubble-row assistant">
                                <div className="chat-avatar">AI</div>
                                <div className="chat-bubble streaming">
                                    <ChatBubbleContent
                                        content={streamingContent}
                                        onDownload={handleDownload}
                                        onAddToDataset={handleAddToDataset}
                                    />
                                    <span className="streaming-cursor" />
                                </div>
                            </div>
                        )}

                        {/* Loading: waiting for first token or tool calls */}
                        {isLoading && streamingContent === null && (
                            <LoadingBubble tools={activeTools} />
                        )}
                    </div>

                    <div className="chat-input-area">
                        <input
                            ref={uploadInputRef}
                            type="file"
                            accept="image/*"
                            className="chat-hidden-file-input"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) handleUploadMedia(file);
                                event.target.value = "";
                            }}
                        />
                        {/* Autocomplete dropdown */}
                        {autocomplete && (
                            <div className="chat-autocomplete">
                                {autocomplete.matches.map((a, i) => (
                                    <div
                                        key={a.name}
                                        className={`chat-autocomplete-item${i === autocomplete.selectedIndex ? " selected" : ""}`}
                                        onMouseDown={e => { e.preventDefault(); applyAutocomplete(a); }}
                                    >
                                        <code>@{a.name}</code>
                                        <span>{a.tool}({a.param}=…)</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {showAttachMenu && (
                            <div className="chat-attach-menu">
                                <button
                                    type="button"
                                    className="chat-attach-menu-item"
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        uploadInputRef.current?.click();
                                    }}
                                >
                                    Upload Media
                                </button>
                                <button
                                    type="button"
                                    className="chat-attach-menu-item"
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        setShowMediaPicker(true);
                                    }}
                                >
                                    Pick Existing Media
                                </button>
                            </div>
                        )}

                        {pendingUpload ? (
                            <div className="chat-upload-preview">
                                <img src={pendingUpload.previewUrl} alt={pendingUpload.name} />
                                <span>{pendingUpload.name}</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        URL.revokeObjectURL(pendingUpload.previewUrl);
                                        setPendingUpload(null);
                                    }}
                                    aria-label="Remove upload"
                                >
                                    ×
                                </button>
                            </div>
                        ) : null}

                        {pendingPickedMedia ? (
                            <div className="chat-upload-preview">
                                <img src={pendingPickedMedia.url} alt={pendingPickedMedia.name} />
                                <span>{pendingPickedMedia.name}</span>
                                <button type="button" onClick={() => setPendingPickedMedia(null)} aria-label="Remove picked media">
                                    ×
                                </button>
                            </div>
                        ) : null}

                        <div className="chat-input-row">
                            <button
                                className="chat-plus-btn"
                                type="button"
                                aria-label="Add media"
                                aria-expanded={showAttachMenu}
                                onClick={() => setShowAttachMenu(prev => !prev)}
                                disabled={isLoading}
                            >
                                +
                            </button>
                            <textarea
                                ref={textareaRef}
                                className="chat-input"
                                placeholder='Type a message, @download <url>, or attach an image'
                                value={input}
                                rows={1}
                                onChange={handleInputChange}
                                onKeyDown={handleKeyDown}
                            />
                            <button
                                className="primary-button chat-send-btn"
                                onClick={() => void handleSend()}
                                disabled={(!input.trim() && !pendingUpload && !pendingPickedMedia) || isLoading}
                            >
                                {isLoading ? "…" : "Send"}
                            </button>
                        </div>
                        <div className="chat-input-hint">Enter to send · Shift+Enter for new line · + uploads an image · Tab completes @alias/@download</div>
                    </div>
                </div>
            </PageSection>

            <MediaPicker
                open={showMediaPicker}
                onClose={() => setShowMediaPicker(false)}
                onPick={handlePickMedia}
                accept="image"
            />

            {/* Alias modal */}
            {showAliasModal && (
                <AliasModal
                    aliases={aliases}
                    onAdd={handleAddAlias}
                    onDelete={handleDeleteAlias}
                    onClose={() => setShowAliasModal(false)}
                />
            )}

            {/* Dataset modal */}
            {showDatasetModal && (
                <div className="modal-backdrop" onClick={() => setShowDatasetModal(false)}>
                    <div className="modal-box" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="eyebrow">Export</span>
                            <h3>Add to Dataset</h3>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: 16 }}>Select a dataset to save this image to:</p>
                            <div className="list-stack" style={{ maxHeight: 300, overflowY: "auto" }}>
                                {datasets.map(ds => (
                                    <button
                                        key={ds.id}
                                        className="list-item"
                                        onClick={() => void confirmAddToDataset(ds.id)}
                                    >
                                        <strong>{ds.name}</strong>
                                        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{ds.path}</span>
                                    </button>
                                ))}
                                {datasets.length === 0 && (
                                    <div className="empty-state">No datasets found. Create one first.</div>
                                )}
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="secondary-button" onClick={() => setShowDatasetModal(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
