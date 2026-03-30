/**
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Blog & SocialFi API (Unified & Revised)
 * Version: 2.1.0
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { desc, eq, sql } from 'drizzle-orm';
import { posts, users, postFavorites, auditLogs } from '../../db/schema'; // Import auditLogs
import { authSignature } from '../../middleware/auth_signature';
import { Database } from '../../db';

// Schema Zod para criação/edição, alinhado ao banco de dados
const createPostSchema = z.object({
  title: z.string().min(3, "O título é muito curto"),
  content: z.string().min(10, "O conteúdo é muito curto"),
  slug: z.string().regex(/^[a-z0-9-]+$/, "Slug inválido"),
  description: z.string().max(160, "A descrição é muito longa").optional(),
  category: z.string().optional().default('Geral'),
  coverUrl: z.string().url("URL da imagem de capa inválida").optional(),
  tags: z.array(z.string()).optional().default([]),
  publish: z.boolean().optional().default(true),
  isFeatured: z.boolean().optional().default(false),
  isTrending: z.boolean().optional().default(false),
});

// Schema Zod para validar o parâmetro :id
const postIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "ID de post inválido").transform(Number),
});


type AppType = {
  Bindings: { DB: D1Database; JWT_SECRET: string };
  Variables: { db: Database; user: { userId: number; role: string } };
};

const blog = new Hono<AppType>();

// =================================================================
// 1. ROTAS PÚBLICAS (LEITURA)
// =================================================================

blog.get('/', async (c) => {
  const db = c.get('db');
  
  try {
    const data = await db
      .select({
        id: posts.id,
        title: posts.title,
        slug: posts.slug,
        description: posts.description,
        category: posts.category,
        coverUrl: posts.coverUrl,
        totalViews: posts.totalViews,
        totalFavorites: posts.totalFavorites,
        isFeatured: posts.isFeatured,
        isTrending: posts.isTrending,
        publish: posts.publish,
        createdAt: posts.createdAt,
        author: {
          id: users.id,
          name: sql<string>`${users.firstName} || \' \' || ${users.lastName}`,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .where(eq(posts.publish, true)) 
      .orderBy(desc(posts.createdAt))
      .limit(30);

    return c.json({ success: true, data });
  } catch (error) {
    console.error("Erro ao buscar feed:", error);
    return c.json({ success: false, message: 'Erro ao buscar feed.' }, 500);
  }
});

blog.get('/:slug', async (c) => {
  const db = c.get('db');
  const slug = c.req.param('slug');

  try {
    const [post] = await db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        description: posts.description,
        slug: posts.slug,
        category: posts.category,
        tags: posts.tags,
        coverUrl: posts.coverUrl,
        totalViews: posts.totalViews,
        totalFavorites: posts.totalFavorites,
        createdAt: posts.createdAt,
        author: {
          id: users.id,
          name: sql<string>`${users.firstName} || \' \' || ${users.lastName}`,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .where(eq(posts.slug, slug));
    
    if (!post) return c.json({ success: false, message: 'Post não encontrado' }, 404);

    const favorites = await db
      .select({
        name: sql<string>`${users.firstName}`,
        avatarUrl: users.avatarUrl,
      })
      .from(postFavorites)
      .leftJoin(users, eq(postFavorites.userId, users.id))
      .where(eq(postFavorites.postId, post.id))
      .limit(5);

    c.executionCtx.waitUntil(
      db.update(posts)
        .set({ totalViews: sql`${posts.totalViews} + 1` })
        .where(eq(posts.id, post.id))
    );

    // Drizzle/D1 com modo 'json' já faz o parse, então 'tags' deve ser um array.
    return c.json({ success: true, data: { ...post, favoritePerson: favorites } });

  } catch (error) {
    console.error(`Erro ao carregar artigo [${slug}]:`, error);
    return c.json({ success: false, message: 'Erro ao carregar artigo.' }, 500);
  }
});

// =================================================================
// 2. ROTAS PRIVADAS (Ações SocialFi & Escrita)
// =================================================================

blog.use('/*', authSignature);

// Criar Post
blog.post('/', zValidator('json', createPostSchema), async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const postData = c.req.valid('json');

  try {
    const [newPost] = await db.insert(posts).values({
      ...postData,
      authorId: user.userId,
    }).returning();

    // 🟢 AUDITORIA FORENSE
    c.executionCtx.waitUntil(
      db.insert(auditLogs).values({
        actorId: user.userId,
        action: 'BLOG_POST_CREATE',
        status: 'success',
        ipAddress: c.req.header('cf-connecting-ip') || 'unknown',
        metadata: { postId: newPost.id, slug: newPost.slug }
      })
    );

    return c.json({ success: true, data: newPost }, 201);
  } catch (error: any) {
    console.error("Erro ao criar post:", error);
    // Erro de slug duplicado
    if (error.message?.includes('UNIQUE constraint failed: posts.slug')) {
        return c.json({ success: false, message: 'Este slug já está em uso.'}, 409);
    }
    return c.json({ success: false, message: 'Não foi possível criar o post.' }, 500);
  }
});

// Favoritar Post
blog.post('/:id/favorite', zValidator('param', postIdSchema), async (c) => {
  const db = c.get('db');
  const userId = c.get('user').userId;
  const { id: postId } = c.req.valid('param');

  try {
    await db.insert(postFavorites).values({ userId, postId });
    
    c.executionCtx.waitUntil(
        db.update(posts)
          .set({ totalFavorites: sql`${posts.totalFavorites} + 1` })
          .where(eq(posts.id, postId))
    );

    return c.json({ success: true, message: 'Favoritado com sucesso!' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return c.json({ success: false, message: 'Você já favoritou este post.' }, 409);
    }
    console.error(`Erro ao favoritar post [${postId}]:`, error);
    return c.json({ success: false, message: 'Não foi possível completar a ação.' }, 500);
  }
});

export default blog;