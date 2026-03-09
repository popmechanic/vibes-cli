export default {
  async fetch() {
    return Response.redirect(
      "https://raw.githubusercontent.com/popmechanic/vibes-cli/main/scripts/install.sh",
      302
    );
  },
};
