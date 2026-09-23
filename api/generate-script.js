export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST requests are allowed."
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY is missing in Vercel."
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Reply with exactly: VIRALTAP_TEST_OK"
                }
              ]
            }
          ]
        })
      }
    );

    const responseText = await response.text();

    let parsed;

    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = {
        rawResponse: responseText
      };
    }

    if (!response.ok) {
      return res.status(200).json({
        success: false,
        diagnostic: true,
        geminiHttpStatus: response.status,
        geminiStatusText: response.statusText,
        geminiResponse: parsed
      });
    }

    return res.status(200).json({
      success: true,
      diagnostic: true,
      message: "Gemini API connection is working.",
      geminiHttpStatus: response.status,
      geminiResponse: parsed
    });

  } catch (error) {
    return res.status(200).json({
      success: false,
      diagnostic: true,
      error: error?.message || "Unknown error"
    });
  }
}
