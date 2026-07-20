/**
 * POST /api/presubmission — extract text from the prejudged document (D-019).
 *
 * Some events require materials before competition: a report, a business plan, a
 * portfolio. Criteria about that document can only be judged if it's submitted, so
 * the UI offers an upload; this route turns the PDF into text and hands it straight
 * back. Nothing is stored — the extracted text rides along in the grade request,
 * joins the grounding corpus, and criteria about the document get scored for real.
 *
 * Why text and not the intact PDF: the grade request already carries the audio near
 * the platform's 4.5MB body cap, and a report is prose — extraction is faithful for
 * prose (D-014's keep-the-PDF-intact rule was about rating-sheet TABLES). Text also
 * makes source-"document" quotes groundable, which an opaque PDF would not.
 */
import { PDFParse } from 'pdf-parse';

export const maxDuration = 60;
export const runtime = 'nodejs';

/** Keep the judge's context sane: ~80k chars ≈ 20k tokens. FBLA reports fit easily. */
const MAX_TEXT_CHARS = 80_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return Response.json(
      { error: { code: 'no_file', message: 'No document was included in that upload.' } },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json(
      {
        error: {
          code: 'too_big',
          message: 'That document is over 8MB. Export it as a plain PDF and try again.',
        },
      },
      { status: 413 },
    );
  }

  const name = file.name || 'document';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(name);
  const isText = file.type.startsWith('text/') || /\.(txt|md)$/i.test(name);
  if (!isPdf && !isText) {
    return Response.json(
      {
        error: {
          code: 'bad_type',
          message: 'Upload the document as a PDF (or plain text). Word files: export to PDF first.',
        },
      },
      { status: 400 },
    );
  }

  try {
    let text: string;
    if (isPdf) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      text = (await new PDFParse({ data: bytes }).getText()).text;
    } else {
      text = await file.text();
    }

    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 50) {
      return Response.json(
        {
          error: {
            code: 'no_text',
            message:
              "We couldn't read any text in that document. If it's a scanned image, export a text-based PDF instead.",
          },
        },
        { status: 422 },
      );
    }

    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS);

    return Response.json({
      name,
      text,
      chars: text.length,
      words: text.split(/\s+/).length,
      truncated,
    });
  } catch (err) {
    console.error('[api/presubmission] failed:', err);
    return Response.json(
      { error: { code: 'parse_failed', message: "We couldn't read that document. Try re-exporting it as a PDF." } },
      { status: 422 },
    );
  }
}
