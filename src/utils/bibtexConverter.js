export async function convertToBibtex(input) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please check your .env file.");
    }

    const trimmedInput = input.trim();
    if (!trimmedInput) return null;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `You are a helpful assistant that converts literature citations into BibTeX format. 
            The user will provide text containing one or more references. 
            Please output a STRICT JSON ARRAY of objects. Each object should represent one citation and have the following fields:
            - "original": The original text segment for this citation.
            - "bibtex": The full BibTeX entry string.
            - "title": The title of the paper (cleaned).
            - "doi": The DOI if present.
            - "pmid": The PubMed ID if present.
            - "extracted_journal": The name of the journal/publisher as it appears or is inferred.
            - "extracted_authors": An array of author names strings (e.g. ["Smith J", "Doe A"]).
            - "extracted_year": The year of publication (string).
            - "extracted_volume": The volume (string).
            - "extracted_pages": The page range (string).
            
            Do NOT include markdown formatting (like \`\`\`json). Just the raw JSON string.
            
            INPUT TEXT (inside <citation_text> tags):
            <citation_text>
            ${trimmedInput}
            </citation_text>`
                    }]
                }],
                generationConfig: {
                    temperature: 0.2, // Low temp for accuracy
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `API Error: ${response.status}`);
        }

        const data = await response.json();
        let content = data.candidates[0].content.parts[0].text;
        content = content.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '');

        return JSON.parse(content);

    } catch (error) {
        console.error("Conversion error:", error);
        throw new Error(`Conversion failed (Gemini): ${error.message}`);
    }
}
