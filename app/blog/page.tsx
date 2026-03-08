import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Music Marketing Blog — ReleaseFlow",
  description:
    "Practical guides for independent artists: playlist pitching, release strategy, social media marketing, and more.",
};

export const revalidate = 3600; // ISR: re-generate every hour

async function getPosts() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("blog_posts")
    .select("slug, title, excerpt, published_at, seo_tags")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export default async function BlogListPage() {
  const posts = await getPosts();

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight">Music Marketing Blog</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Practical guides for independent artists — from playlist pitching to release strategy.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet — check back soon.</p>
      ) : (
        <ul className="space-y-10">
          {posts.map((post) => (
            <li key={post.slug} className="border-b pb-10 last:border-0">
              <Link href={`/blog/${post.slug}`} className="group">
                <h2 className="text-xl font-semibold group-hover:text-primary transition-colors">
                  {post.title}
                </h2>
              </Link>
              {post.excerpt && (
                <p className="mt-2 text-muted-foreground">{post.excerpt}</p>
              )}
              <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
                {post.published_at && (
                  <time dateTime={post.published_at}>
                    {new Date(post.published_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </time>
                )}
                {(post.seo_tags as string[] | null)?.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
