// server.js (ESM)
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

app.post("/addMessage", async (req, res) => {
  console.log("Request body:", req.body);
  const message = req.body.message;

  if (!message) {
    return res.status(400).send({ error: "Message is missing" });
  }

  try {
    const response = await fetch(
      "https://script.google.com/macros/s/AKfycbyoqft4V3k67hYw_nv61V-EUBtQstj6wKl67YWwqF7PRuMvkT0Nz5aEOE1neO2XPWt8/exec",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      }
    );

    const data = await response.json();
    console.log("Response from Apps Script:", data);
    res.status(200).send(data);
  } catch (error) {
    console.error("Error sending to Apps Script:", error);
    res.status(500).send("Error sending data to Apps Script");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
