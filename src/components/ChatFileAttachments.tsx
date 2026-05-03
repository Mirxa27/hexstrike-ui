import { useRef } from 'react'
import {
  Paperclip,
  X,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Package,
  Database,
  Network,
  FileCode,
} from 'lucide-react'
import type { UploadedFile } from '../fileAnalysis'
import { detectFileCategory } from '../fileAnalysis'

interface ChatFileAttachmentsProps {
  attachments: UploadedFile[]
  onAdd: (files: UploadedFile[]) => void
  onRemove: (fileId: string) => void
  disabled?: boolean
}

const FILE_ICONS: Record<string, any> = {
  image: ImageIcon,
  document: FileText,
  executable: Package,
  network: Network,
  archive: Archive,
  audio: Music,
  video: Film,
  database: Database,
  memory: FileCode,
  unknown: FileText,
}

export function ChatFileAttachments({ attachments, onAdd, onRemove, disabled }: ChatFileAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const newFiles: UploadedFile[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const category = detectFileCategory(file)

      // Read file as base64
      const reader = new FileReader()
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string)
        reader.readAsDataURL(file)
      })
      const base64 = await base64Promise

      // Generate preview for images
      let preview: string | undefined
      if (category === 'image') {
        preview = base64
      }

      newFiles.push({
        id: `chat-file-${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        type: file.type || 'unknown',
        category,
        data: base64,
        preview,
      })
    }

    onAdd(newFiles)
  }

  const totalSize = attachments.reduce((sum, f) => sum + f.size, 0)
  const sizeMB = (totalSize / 1024 / 1024).toFixed(2)

  return (
    <div className="border-t border-[#1a1a2e] bg-[#0a0a0f] px-4 py-2">
      {/* Attached files */}
      {attachments.length > 0 && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[10px] text-[#6b7280]">
            <Paperclip size={12} />
            <span>{attachments.length} file{attachments.length > 1 ? 's' : ''} attached</span>
            <span>•</span>
            <span>{sizeMB} MB</span>
          </div>
          <button
            onClick={() => attachments.forEach((f) => onRemove(f.id))}
            className="text-[10px] text-[#6b7280] hover:text-[#e63946] transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* File list */}
      <div className="flex flex-wrap gap-2 mb-2">
        {attachments.map((file) => {
          const Icon = FILE_ICONS[file.category] || FileText
          return (
            <div
              key={file.id}
              className="flex items-center gap-2 px-2 py-1.5 bg-[#0f0f1a] border border-[#1a1a2e] rounded-lg group"
            >
              <Icon size={14} className="text-[#e63946]" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-[#e2e8f0] truncate max-w-[150px]">{file.name}</p>
                <p className="text-[8px] text-[#6b7280]">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <button
                onClick={() => onRemove(file.id)}
                className="p-0.5 hover:bg-[#1a1a2e] rounded text-[#6b7280] hover:text-[#e63946] transition-colors opacity-0 group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Upload button */}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => handleFileUpload(e.target.files)}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a2e] hover:bg-[#1a1a2e]/80 border border-[#1a1a2e] hover:border-[#e63946]/50 rounded text-[10px] text-[#94a3b8] hover:text-[#e63946] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Paperclip size={12} />
          Attach files
        </button>
        <span className="text-[8px] text-[#6b7280]">
          Images, documents, executables, PCAPs, archives, and more
        </span>
      </div>
    </div>
  )
}
