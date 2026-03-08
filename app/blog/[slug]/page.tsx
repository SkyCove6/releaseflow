import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

async function getPost(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  return {
    title:       `${post.title} — ReleaseFlow Blog`,
    description: post.excerpt ?? undefined,
    keywords:    (post.seo_tags as string[] | null) ?? undefined,
    openGraph: {
      title:       post.title,
      description: post.excerpt ?? undefined,
      type:        "article",
      publishedTime: post.published_at ?? undefined,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      {/* Breadcrumb */}
      <nav className="mb-8 text-sm text-muted-foreground">
        <Link href="/blog" className="hover:text-foreground">Blog</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{post.title}</span>
      </nav>

      {/* Header */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight leading-tight">
          {post.title}
        </h1>
        <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
          {post.published_at && (
            <time dateTime={post.published_at}>
              {new Date(post.published_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </time>
          )}
          <span>ReleaseFlow Team</span>
        </div>
        {(post.seo_tags as string[] | null)?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {(post.seo_tags as string[]).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {/* Body — rendered from stored HTML */}
      <article
        className="prose prose-neutral dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: post.content_html }}
      />

      {/* CTA */}
      <div className="mt-16 rounded-xl border bg-muted/40 p-8 text-center">
        <h2 className="text-xl font-semibold">Ready to plan your next release?</h2>
        <p className="mt-2 text-muted-foreground">
          ReleaseFlow generates AI-powered campaign strategies, playlist pitches, and
          platform-specific content — in under 60 seconds.
        </p>
        <Link
          href="/signup"
          className="mt-5 inline-flex items-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Get started free →
        </Link>
      </div>
    </main>
  );
}
