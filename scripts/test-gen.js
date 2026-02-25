var WS = require("ws");
var w = new WS("ws://localhost:3333");
var count = 0;

w.on("open", function() {
  process.stdout.write("OPEN\n");
  w.send(JSON.stringify({ type: "generate", prompt: "A simple recipe book", themeId: null }));
  process.stdout.write("SENT generate\n");
});

w.on("message", function(d) {
  count++;
  var m = JSON.parse(d);
  var line = "[MSG " + count + "] " + m.type;
  if (m.stage) line += " stage=" + m.stage;
  if (m.themeId) line += " theme=" + m.themeId;
  if (m.themeName) line += " name=" + m.themeName;
  if (m.message) line += " msg=" + m.message.slice(0, 80);
  if (m.progress != null) line += " progress=" + m.progress;
  process.stdout.write(line + "\n");

  if (m.type === "app_updated") {
    process.stdout.write("SUCCESS - app generated!\n");
    w.close();
    setTimeout(function() { process.exit(0); }, 500);
  }
  if (m.type === "error") {
    process.stdout.write("FAILED: " + m.message + "\n");
    w.close();
    setTimeout(function() { process.exit(1); }, 500);
  }
});

w.on("error", function(e) {
  process.stdout.write("WS_ERROR: " + e.message + "\n");
  process.exit(1);
});

setTimeout(function() {
  process.stdout.write("TIMEOUT after 90s, got " + count + " messages\n");
  process.exit(0);
}, 90000);
