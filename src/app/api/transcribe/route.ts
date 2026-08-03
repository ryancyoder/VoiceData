import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI();
  return client;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());
    const file = await toFile(buffer, "recording.webm");
    const transcription = await getClient().audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    return NextResponse.json({ text: transcription.text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
