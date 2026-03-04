"use client";

import { useState, useEffect, useRef } from "react";
import { useSocket } from "@/lib/socket";
import { Upload, Image, FileText, Trash2, Download, Eye, Grid, List, Search, X, File, Film } from "lucide-react";

interface MediaFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

export default function MediaPage() {
  const { socket, connected } = useSocket();
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [previewData, setPreviewData] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!socket || !connected) return;

    loadFiles();

    socket.on("media:files", (data: { files: MediaFile[] }) => {
      setFiles(data.files);
      setLoading(false);
    });

    socket.on("media:file", (data: { file?: MediaFile & { content?: string }; error?: string }) => {
      if (data.file?.content) {
        setPreviewData(data.file.content);
      }
    });

    socket.on("media:deleted", (data: { success: boolean; id: string }) => {
      if (data.success) {
        setFiles((prev) => prev.filter((f) => f.id !== data.id));
        if (selectedFile?.id === data.id) {
          setSelectedFile(null);
          setPreviewData(null);
        }
      }
    });

    socket.on("file:uploaded", (data: { id?: string; error?: string }) => {
      if (!data.error) {
        loadFiles();
      }
    });

    return () => {
      socket.off("media:files");
      socket.off("media:file");
      socket.off("media:deleted");
      socket.off("file:uploaded");
    };
  }, [socket, connected]);

  const loadFiles = () => {
    socket?.emit("media:list");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    Array.from(selectedFiles).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        socket?.emit("file:upload", {
          filename: file.name,
          content: base64,
          type: file.type,
        });
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDelete = (file: MediaFile) => {
    if (confirm(`Delete "${file.originalName}"?`)) {
      socket?.emit("media:delete", { id: file.id });
    }
  };

  const handlePreview = (file: MediaFile) => {
    setSelectedFile(file);
    socket?.emit("media:get", { id: file.id });
  };

  const filteredFiles = files.filter((file) =>
    file.originalName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return Image;
    if (mimeType.startsWith("video/")) return Film;
    if (mimeType.includes("pdf")) return FileText;
    return File;
  };

  const isImage = (mimeType: string) => mimeType.startsWith("image/");
  const isPdf = (mimeType: string) => mimeType === "application/pdf";
  const isText = (mimeType: string) =>
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml";

  const getPreviewContent = () => {
    if (!previewData) return null;

    if (isImage(selectedFile.mimeType)) {
      return (
        <img
          src={`data:${selectedFile.mimeType};base64,${previewData}`}
          alt={selectedFile.originalName}
          className="w-full rounded-lg"
        />
      );
    }

    if (isPdf(selectedFile.mimeType)) {
      return (
        <iframe
          src={`data:${selectedFile.mimeType};base64,${previewData}#toolbar=0&navpanes=0`}
          className="w-full h-64 rounded-lg"
          title="PDF Preview"
        />
      );
    }

    if (isText(selectedFile.mimeType)) {
      try {
        const text = atob(previewData);
        return (
          <pre className="text-xs text-white/70 overflow-auto max-h-64 p-2 whitespace-pre-wrap">
            {text.slice(0, 2000)}
            {text.length > 2000 && "\n... (truncated)"}
          </pre>
        );
      } catch {
        return <p className="text-white/40">Unable to display text content</p>;
      }
    }

    return null;
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Main Content */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-light">Media Library</h2>
              <p className="text-sm text-white/40">{files.length} files</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search files..."
                  className="w-48 bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              {/* View Toggle */}
              <div className="flex bg-white/5 rounded-lg p-1">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-2 rounded transition-colors ${
                    viewMode === "grid" ? "bg-white/10 text-white" : "text-white/40 hover:text-white"
                  }`}
                >
                  <Grid size={16} />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-2 rounded transition-colors ${
                    viewMode === "list" ? "bg-white/10 text-white" : "text-white/40 hover:text-white"
                  }`}
                >
                  <List size={16} />
                </button>
              </div>

              {/* Upload Button */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.html,.css,.js,.zip,.rar,.7z,.tar,.gz"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!connected}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-lg transition-colors"
              >
                <Upload size={16} />
                Upload
              </button>
            </div>
          </div>

          {/* Files */}
          {loading ? (
            <div className="text-center py-20 text-white/40">Loading files...</div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                <span className="text-blue-400 text-2xl">&#128193;</span>
              </div>
              <h3 className="text-lg font-semibold text-zinc-300 mb-2">
                {searchQuery ? "No files found" : "No media files yet"}
              </h3>
              <p className="text-sm text-zinc-500 max-w-md mx-auto">
                {searchQuery
                  ? "Try a different search term"
                  : "Upload images, PDFs, text files, and more to get started."}
              </p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredFiles.map((file) => {
                const Icon = getFileIcon(file.mimeType);
                return (
                  <div
                    key={file.id}
                    className="group bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden hover:border-white/20 transition-colors cursor-pointer"
                    onClick={() => handlePreview(file)}
                  >
                    {/* Preview */}
                    <div className="aspect-square bg-white/5 flex items-center justify-center relative">
                      {isImage(file.mimeType) ? (
                        <img
                          src={`/api/media/${file.id}`}
                          alt={file.originalName}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                          }}
                        />
                      ) : (
                        <Icon size={32} className="text-white/30" />
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button className="p-2 bg-white/10 rounded-lg hover:bg-white/20">
                          <Eye size={16} className="text-white" />
                        </button>
                      </div>
                    </div>
                    {/* Info */}
                    <div className="p-3">
                      <p className="text-sm text-white/80 truncate">{file.originalName}</p>
                      <p className="text-xs text-white/40">{formatSize(file.sizeBytes)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left text-xs text-white/40 font-medium px-4 py-3">Name</th>
                    <th className="text-left text-xs text-white/40 font-medium px-4 py-3">Type</th>
                    <th className="text-left text-xs text-white/40 font-medium px-4 py-3">Size</th>
                    <th className="text-left text-xs text-white/40 font-medium px-4 py-3">Date</th>
                    <th className="text-right text-xs text-white/40 font-medium px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFiles.map((file) => {
                    const Icon = getFileIcon(file.mimeType);
                    return (
                      <tr
                        key={file.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer"
                        onClick={() => handlePreview(file)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Icon size={16} className="text-white/40" />
                            <span className="text-sm text-white/80 truncate max-w-xs">{file.originalName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-white/40">{file.mimeType}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-white/40">{formatSize(file.sizeBytes)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-white/40">{formatDate(file.createdAt)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleDelete(file)}
                              className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Preview Panel */}
      {selectedFile && (
        <div className="w-96 bg-white/[0.03] border-l border-white/[0.06] p-6 overflow-auto">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-light">Preview</h3>
            <button
              onClick={() => {
                setSelectedFile(null);
                setPreviewData(null);
              }}
              className="p-1 hover:bg-white/5 rounded"
            >
              <X size={18} className="text-white/40" />
            </button>
          </div>

          {/* Preview Content */}
          <div className="bg-white/5 rounded-xl p-4 mb-6 min-h-[200px]">
            {previewData ? (
              getPreviewContent()
            ) : (
              <div className="aspect-square flex items-center justify-center">
                <File size={48} className="text-white/30" />
              </div>
            )}
          </div>

          {/* File Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-white/40">Name</span>
              <span className="text-xs text-white/80 truncate max-w-[200px]">{selectedFile.originalName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-white/40">Type</span>
              <span className="text-xs text-white/80">{selectedFile.mimeType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-white/40">Size</span>
              <span className="text-xs text-white/80">{formatSize(selectedFile.sizeBytes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-white/40">Uploaded</span>
              <span className="text-xs text-white/80">{formatDate(selectedFile.createdAt)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-6">
            <a
              href={`/api/media/${selectedFile.id}`}
              download={selectedFile.originalName}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-sm rounded-lg transition-colors"
            >
              <Download size={14} />
              Download
            </a>
            <button
              onClick={() => handleDelete(selectedFile)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-sm rounded-lg transition-colors"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
