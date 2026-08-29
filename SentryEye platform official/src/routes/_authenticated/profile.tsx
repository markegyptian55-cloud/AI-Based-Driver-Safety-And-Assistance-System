import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, User as UserIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ErrorBoundary, ErrorState } from "@/components/error-boundary";
import { useAuth } from "@/hooks/use-auth";
import { useRoles } from "@/hooks/use-roles";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/format-error";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — SentryEye" },
      {
        name: "description",
        content: "Your SentryEye account details, assigned roles, and display name.",
      },
    ],
  }),
  component: () => (
    <ErrorBoundary title="Profile is unavailable">
      <ProfilePage />
    </ErrorBoundary>
  ),
});

function ProfilePage() {
  const { user } = useAuth();
  const { roles } = useRoles();
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,display_name,bio,created_at,updated_at")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    if (profile.data) {
      setDisplayName(profile.data.display_name ?? "");
      setBio(profile.data.bio ?? "");
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: displayName.trim() || null, bio: bio.trim() || null })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated");
      void queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const email = user?.email ?? "";
  const initials = (displayName.trim()[0] ?? email[0] ?? "?").toUpperCase();

  if (profile.isError) {
    return (
      <ErrorState
        title="Couldn't load your profile"
        error={profile.error}
        onRetry={() => void profile.refetch()}
        retrying={profile.isFetching}
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account identity and the roles that determine what you can access.
        </p>
      </div>

      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-primary/20 text-lg font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">
              {profile.isLoading ? <Skeleton className="h-5 w-40" /> : displayName || email}
            </p>
            <p className="truncate text-sm text-muted-foreground">{email}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {roles.length === 0 ? (
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                no role
              </Badge>
            ) : (
              roles.map((role) => (
                <Badge
                  key={role}
                  variant="outline"
                  className="border-primary/40 font-mono text-[10px] uppercase text-primary"
                >
                  {role}
                </Badge>
              ))
            )}
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <UserIcon className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Account details
          </h2>
        </div>

        {profile.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={displayName}
                maxLength={80}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How you appear in reports"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Notes</Label>
              <Textarea
                id="bio"
                value={bio}
                maxLength={500}
                rows={3}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Optional context about this operator account"
              />
            </div>

            <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="font-mono uppercase">Email</dt>
                <dd className="min-w-0 break-all">{email}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-mono uppercase">Member since</dt>
                <dd>
                  {profile.data?.created_at
                    ? new Date(profile.data.created_at).toLocaleDateString()
                    : "—"}
                </dd>
              </div>
            </dl>

            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="mr-2 h-4 w-4" aria-hidden="true" />
              {save.isPending ? "Saving…" : "Save profile"}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
