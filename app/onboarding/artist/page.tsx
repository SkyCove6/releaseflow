"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Stepper } from "@/components/ui/stepper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

const steps = ["Artist info", "Voice profile", "Review"];

function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function ArtistOnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [captions, setCaptions] = useState("");
  const [artistBio, setArtistBio] = useState("");
  const [interviewExcerpts, setInterviewExcerpts] = useState("");

  const createArtist = trpc.artist.create.useMutation({
    onSuccess: () => {
      toast.success("Artist created. Voice profile generation started.");
      router.push("/dashboard");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const parsedCaptions = useMemo(() => splitLines(captions), [captions]);
  const parsedExcerpts = useMemo(() => splitLines(interviewExcerpts), [interviewExcerpts]);

  const canNextStep =
    (step === 0 && name.trim().length > 0 && genre.trim().length > 0) ||
    (step === 1 && artistBio.trim().length > 0) ||
    step === 2;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center p-4 sm:p-8">
      <Card className="w-full">
        <CardHeader className="space-y-4">
          <CardTitle>Artist onboarding</CardTitle>
          <p className="text-sm text-muted-foreground">
            Complete this in under 3 minutes to generate your first campaign.
          </p>
          <Stepper steps={steps} currentStep={step} />
        </CardHeader>

        <CardContent className="space-y-5">
          {step === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="artist-name">Artist name</Label>
                <Input id="artist-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="artist-genre">Genre</Label>
                <Input id="artist-genre" value={genre} onChange={(event) => setGenre(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="spotify-url">Spotify URL</Label>
                <Input id="spotify-url" value={spotifyUrl} onChange={(event) => setSpotifyUrl(event.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="instagram-url">Instagram URL</Label>
                <Input id="instagram-url" value={instagramUrl} onChange={(event) => setInstagramUrl(event.target.value)} />
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <Tabs defaultValue="captions" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="captions">Captions</TabsTrigger>
                <TabsTrigger value="bio">Bio</TabsTrigger>
                <TabsTrigger value="interviews">Interviews</TabsTrigger>
              </TabsList>
              <TabsContent value="captions" className="space-y-2">
                <Label htmlFor="captions">Past captions (one per line)</Label>
                <Textarea
                  id="captions"
                  value={captions}
                  onChange={(event) => setCaptions(event.target.value)}
                  className="min-h-40"
                />
              </TabsContent>
              <TabsContent value="bio" className="space-y-2">
                <Label htmlFor="artist-bio">Artist bio</Label>
                <Textarea
                  id="artist-bio"
                  value={artistBio}
                  onChange={(event) => setArtistBio(event.target.value)}
                  className="min-h-40"
                />
              </TabsContent>
              <TabsContent value="interviews" className="space-y-2">
                <Label htmlFor="interview-excerpts">Interview excerpts (optional)</Label>
                <Textarea
                  id="interview-excerpts"
                  value={interviewExcerpts}
                  onChange={(event) => setInterviewExcerpts(event.target.value)}
                  className="min-h-40"
                />
              </TabsContent>
            </Tabs>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="rounded border p-3 text-sm">
                <p><span className="font-medium">Name:</span> {name}</p>
                <p><span className="font-medium">Genre:</span> {genre}</p>
                <p><span className="font-medium">Spotify:</span> {spotifyUrl || "Not provided"}</p>
                <p><span className="font-medium">Instagram:</span> {instagramUrl || "Not provided"}</p>
              </div>
              <div className="rounded border p-3 text-sm">
                <p className="font-medium">Voice profile source content</p>
                <p>Captions: {parsedCaptions.length}</p>
                <p>Interview excerpts: {parsedExcerpts.length}</p>
                <p>Bio length: {artistBio.trim().length} chars</p>
              </div>
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0 || createArtist.isPending}
          >
            Back
          </Button>

          {step < 2 ? (
            <Button onClick={() => setStep((current) => Math.min(2, current + 1))} disabled={!canNextStep}>
              Continue
            </Button>
          ) : (
            <Button
              onClick={() =>
                createArtist.mutate({
                  name,
                  genre,
                  spotifyUrl: spotifyUrl || undefined,
                  instagramUrl: instagramUrl || undefined,
                  pastCaptions: parsedCaptions,
                  artistBio,
                  interviewExcerpts: parsedExcerpts,
                })
              }
              disabled={createArtist.isPending}
            >
              {createArtist.isPending ? "Creating artist..." : "Create artist"}
            </Button>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}

