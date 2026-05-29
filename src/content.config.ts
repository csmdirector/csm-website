import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const seoFields = {
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  canonicalPath: z.string().optional(),
  noindex: z.boolean().default(false)
};

const programSchema = z.object({
  title: z.string(),
  description: z.string(),
  order: z.number().default(0),
  audience: z.array(z.string()).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  ...seoFields
});

const parentResources = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/parent-resources' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.date(),
    updatedDate: z.date().optional(),
    audience: z.array(z.string()).default(['Parents']),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    instruments: z.array(z.string()).default([]),
    ageRanges: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    status: z.enum(['draft', 'published']).default('draft'),
    related: z.array(z.string()).default([]),
    ctaLabel: z.string().optional(),
    ctaHref: z.string().optional(),
    ...seoFields
  })
});

const programContent = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/musical-ascent' }),
  schema: programSchema
});

const teacherResources = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/teacher-resources' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    categories: z.array(z.string()).default([]),
    status: z.enum(['draft', 'published']).default('draft'),
    ...seoFields
  })
});

export const collections = {
  'parent-resources': parentResources,
  'musical-ascent': programContent,
  mdl: defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/mdl' }),
    schema: programSchema
  }),
  'teacher-resources': teacherResources
};
