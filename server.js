const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔑 Zoho Credentials (yaha apne values daalo)
const CLIENT_ID = "1000.2ENFLE77MM98BW8WDZ74ARGDDQ48CO";
const CLIENT_SECRET = "75058c4607f7607086acb5ca9e2d3ef4b818d2e071";
const REFRESH_TOKEN = "1000.8ca5eb99f6d004a069eee442e576f7f5.28cd337dc6a48f286be9e3e6c70be0b4";

let accessToken = "1000.58efc7666cca8c66cdd401383fb14fd7.c1972fe98005faa0cdb556c3d55e7033";

// 🔄 Auto Refresh Token
async function refreshAccessToken() {
    try {
        const response = await axios.post(
            "https://accounts.zoho.in/oauth/v2/token",
            null,
            {
                params: {
                    refresh_token: REFRESH_TOKEN,
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: "refresh_token",
                },
            }
        );

        accessToken = response.data.access_token;
        console.log("🔄 New Access Token Generated");
    } catch (error) {
        console.error("❌ Token Refresh Error:", error.response?.data || error.message);
    }
}

// 🟢 Shopify Webhook
app.post("/webhook/shopify", async (req, res) => {
    const data = req.body;
    console.log("📦 Order Received:", data.id);

    try {
        let contactId = null;

        if (data.email) {
            contactId = await createOrGetContact(data);
        }

        if (data.total_price) {
            await createDeal(data, contactId);
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Error:", error.response?.data || error.message);
        res.sendStatus(500);
    }
});

// 🟢 Create or Get Contact (duplicate fix)
async function createOrGetContact(data) {
    const email = data.email;

    try {
        const search = await axios.get(
            `https://www.zohoapis.in/crm/v2/Contacts/search?email=${email}`,
            {
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`,
                },
            }
        );

        if (search.data.data) {
            console.log("👤 Contact already exists");
            return search.data.data[0].id;
        }
    } catch (err) {
        // ignore if not found
    }

    try {
        const response = await axios.post(
            "https://www.zohoapis.in/crm/v2/Contacts",
            {
                data: [{
                    First_Name: data.first_name || "",
                    Last_Name: data.last_name || "Shopify",
                    Email: data.email,
                    Phone: data.phone || ""
                }]
            },
            {
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`,
                }
            }
        );

        console.log("✅ New Contact Created");
        return response.data.data[0].details.id;

    } catch (error) {
        if (error.response?.data?.code === "INVALID_TOKEN") {
            await refreshAccessToken();
            return createOrGetContact(data); // retry
        }
        throw error;
    }
}

// 🟢 Create Deal + Link Contact
async function createDeal(data, contactId) {
    try {
        await axios.post(
            "https://www.zohoapis.in/crm/v2/Deals",
            {
                data: [{
                    Deal_Name: `Order #${data.id}`,
                    Amount: data.total_price,
                    Stage: "Closed Won",
                    Closing_Date: new Date().toISOString().split("T")[0],
                    Contact_Name: contactId
                }]
            },
            {
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`,
                }
            }
        );

        console.log("💰 Deal Created");

    } catch (error) {
        if (error.response?.data?.code === "INVALID_TOKEN") {
            await refreshAccessToken();
            return createDeal(data, contactId); // retry
        }
        throw error;
    }
}

// 🧪 Health check (browser me open karke test kar sakte ho)
app.get("/", (req, res) => {
    res.send("🚀 Shopify → Zoho CRM Integration Running");
});

// 🚀 Server start
app.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});