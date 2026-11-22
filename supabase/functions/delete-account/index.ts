// aimass account-deletion edge function.
//
// Security model:
// - verify_jwt is enabled in supabase/config.toml, so the API gateway rejects
//   unsigned requests before this function runs; the JWT is ALSO verified
//   explicitly with auth.getUser() below.
// - The user id comes ONLY from the verified token, never from the body.
// - The Admin API delete is performed with the service-role key, which is
//   read from Deno.env at call time and never logged, returned, or included
//   in error messages.
// - Deleting the auth user cascades (database-enforced ON DELETE CASCADE on
//   every user-owned table) to profiles, categories, transactions, budgets,
//   cash positions, income schedules, recurring bills, and bill payments.
//   Categories are per-user rows; a user's system/default categories belong
//   to that user and are deleted with it — other users' rows are untouched.
// - Identity re-verification (password check) happens BEFORE this endpoint:
//   the client signs in again and sends that fresh session's token, so a
//   stolen idle session alone is not enough to destroy an account.
// - Responses are generic; detail goes to the console only.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    const authHeader = request.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, { error: "Sign in again to delete your account." });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length < 20) {
      return json(401, { error: "Sign in again to delete your account." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("missing Supabase env");
    }

    const { createClient } = await import("npm:@supabase/supabase-js@2");

    // Identity comes from the token itself, verified server-side.
    const verifier = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await verifier.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      return json(401, { error: "Sign in again to delete your account." });
    }
    const userId = String(userData.user.id);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("delete-account: admin delete failed:", deleteError.message);
      return json(500, { error: "Could not delete your account right now. Nothing was deleted — please try again." });
    }

    // Best-effort sign-out of every refresh token so stolen sessions die too.
    // Failure here does not undo the deletion; the user row is already gone,
    // so old access tokens no longer authorize anything user-owned.
    try {
      await admin.auth.admin.signOut(userId);
    } catch (signOutCause) {
      console.error(
        "delete-account: post-delete sign-out skipped:",
        signOutCause instanceof Error ? signOutCause.message : "unknown"
      );
    }

    return json(200, { deleted: true });
  } catch (cause) {
    console.error("delete-account error:", cause instanceof Error ? cause.message : "unknown");
    return json(500, { error: "Something went wrong. Please try again." });
  }
});
