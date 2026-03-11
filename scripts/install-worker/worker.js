export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // PUT /upload — upload a DMG (requires auth header)
    if (request.method === "PUT" && url.pathname === "/upload") {
      const auth = request.headers.get("X-Upload-Key");
      if (!auth || auth !== env.UPLOAD_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }
      const filename = url.searchParams.get("filename") || "VibesOS.dmg";
      await env.DMG_BUCKET.put(filename, request.body, {
        httpMetadata: { contentType: "application/x-apple-diskimage" },
      });
      // Also store as "latest" pointer
      await env.DMG_BUCKET.put("latest.txt", filename);
      return new Response(`Uploaded ${filename}`, { status: 200 });
    }

    // GET / — redirect to DMG download (browser) or serve install script (curl)
    const ua = (request.headers.get("User-Agent") || "").toLowerCase();
    const isCurl = ua.includes("curl") || ua.includes("wget");

    if (isCurl) {
      // CLI users still get the shell script
      return Response.redirect(
        "https://raw.githubusercontent.com/popmechanic/vibes-cli/main/scripts/install.sh",
        302
      );
    }

    // Browser users get the DMG
    const latestObj = await env.DMG_BUCKET.get("latest.txt");
    const filename = latestObj ? await latestObj.text() : "VibesOS.dmg";
    const dmg = await env.DMG_BUCKET.get(filename);

    if (!dmg) {
      return new Response("DMG not found. Upload one first.", { status: 404 });
    }

    return new Response(dmg.body, {
      headers: {
        "Content-Type": "application/x-apple-diskimage",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "public, max-age=300",
      },
    });
  },
};
