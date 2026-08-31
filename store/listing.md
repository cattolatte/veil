# Store listing copy

## Name
Veil — private screen understanding for AI agents

## Short description (132 chars max)
AI agents that read your screen without seeing your secrets. Passwords, Aadhaar and faces are removed before anything is sent.

## Detailed description

Veil lets an AI assistant help you with what is on your screen, without your
private information ever leaving your computer.

Most "AI that can see your screen" tools upload a screenshot to a server, which
then decides what was sensitive. By then it is too late — your password was in
that picture.

Veil reverses the order. A small model runs **inside your browser**, works out
which parts of the screen are sensitive, and destroys them **before any network
request is made**. Only an anonymised description leaves your machine.

**What it protects**
• Passwords and one-time codes
• Aadhaar, PAN, passport and other government identifiers
• Card numbers, IFSC codes, UPI addresses
• Email addresses and phone numbers
• Names and postal addresses
• Faces in images

**How it works**
• Reads the page structure to identify sensitive fields exactly
• Runs a 1.7 MB vision model on your graphics card to catch what the structure
  cannot see — text drawn into images or canvases
• Replaces sensitive values with typed labels such as [[AADHAAR]]
• Sends only that description to the server, which replies with an action

**Built for privacy, measured for it**
• 100% redaction precision on real web pages
• Nine milliseconds for a typical scan
• Every failure path hides more, never less
• Twenty-six automated tests, six asserting the privacy guarantees specifically

Open configuration: point it at your own server, or a local model via Ollama.

## Category
Productivity

## Permission justification

**activeTab** — Needed to read the page you explicitly invoke Veil on, so it can
find and redact sensitive content. Access is granted only for that tab and only
until you navigate away.

**scripting** — Needed to run the detection and redaction code inside the page.
This code is what removes sensitive data; it must run where the data is.

**storage** — Stores your settings (server URL, step limit) and optional local
run history. Nothing is transmitted.

**host permissions (&lt;all_urls&gt;)** — Sensitive data can appear on any site, so
the extension must be able to operate wherever you invoke it. It does not run
automatically: nothing happens until you click the toolbar button.

**No data collection.** Veil transmits an anonymised description of the page to
a server address that you configure. It sends no analytics, no telemetry and no
identifiers, and the authors receive nothing.
