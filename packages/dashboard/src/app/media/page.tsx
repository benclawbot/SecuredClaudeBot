"use client";

export default function MediaPage() {
  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">Media</h2>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-blue-400 text-2xl">&#128193;</span>
          </div>
          <h3 className="text-lg font-semibold text-zinc-300 mb-2">
            Media Browser
          </h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto mb-4">
            Browse uploaded files, images, PDFs, and attachments. Supports image
            processing, PDF extraction, and vision AI analysis.
          </p>
          <p className="text-xs text-zinc-600">
            Coming in Phase 10 — Media module
          </p>
        </div>
      </div>
    </div>
  );
}
