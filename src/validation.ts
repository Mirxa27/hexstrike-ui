import { z } from 'zod'

// Tool catalog from backend
export const HexstrikeToolSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  category: z.string().default('uncategorized'),
})

export const HexstrikeCategorySchema = z.object({
  name: z.string(),
  display_name: z.string(),
  tool_count: z.number(),
  tools: z.array(z.string()),
})

export type HexstrikeTool = z.infer<typeof HexstrikeToolSchema>
export type HexstrikeCategory = z.infer<typeof HexstrikeCategorySchema>

// Health payload
export const HealthPayloadSchema = z.object({
  status: z.string().optional(),
  tools_status: z.record(z.boolean()).optional(),
  os_type: z.string().optional(),
  package_managers: z
    .object({
      apt: z.boolean().optional(),
      apk: z.boolean().optional(),
      pip: z.boolean().optional(),
      npm: z.boolean().optional(),
    })
    .optional(),
}).passthrough()

// Model list from providers
export const OpenAIModelSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  created: z.number().optional(),
  owned_by: z.string().optional(),
})

// Tool execution result validation (best-effort, allow any if not schema)
export const ToolResultSchema = z.unknown()

// Type for the tools_status record
type ToolsStatusRecord = Record<string, boolean>

// Export validation functions
export function validateTools(data: unknown): { tools: HexstrikeTool[]; categories: HexstrikeCategory[] } {
  const payload = data as Record<string, unknown>
  const rawTools = (payload.tools ?? payload ?? []) as unknown[]
  const tools: HexstrikeTool[] = []
  for (const t of rawTools) {
    const result = HexstrikeToolSchema.safeParse(t)
    if (result.success) tools.push(result.data)
  }
  // derive categories
  const catMap: Record<string, string[]> = {}
  for (const t of tools) {
    const cat = t.category
    if (!catMap[cat]) catMap[cat] = []
    catMap[cat].push(t.name)
  }
  const categories = Object.entries(catMap).map(([name, toolNames]) => {
    const result = HexstrikeCategorySchema.safeParse({
      name,
      display_name: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      tool_count: toolNames.length,
      tools: toolNames,
    })
    return result.success ? result.data : {
      name,
      display_name: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      tool_count: toolNames.length,
      tools: toolNames,
    }
  })
  return { tools, categories }
}

export function validateHealth(data: unknown): ToolsStatusRecord | null {
  const result = HealthPayloadSchema.safeParse(data)
  return result.success ? (result.data.tools_status ?? null) : null
}
