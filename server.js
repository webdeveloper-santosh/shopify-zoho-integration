const express = require("express");
const axios = require("axios");


process.on("uncaughtException", (err) => {
    console.error("💥 Uncaught Exception:", err.message);
});

process.on("unhandledRejection", (err) => {
    console.error("💥 Unhandled Rejection:", err);
});
const app = express();
app.use(express.json());

// 🔑 Zoho Credentials (yaha apne values daalo)
const CLIENT_ID = "1000.2ENFLE77MM98BW8WDZ74ARGDDQ48CO";
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REFRESH_TOKEN = "1000.8ca5eb99f6d004a069eee442e576f7f5.28cd337dc6a48f286be9e3e6c70be0b4";

const accessToken = process.env.ACCESS_TOKEN;

// 🔄 Refresh Access Token
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
            contactId = await createContact(data);
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

// 🟢 Create Contact
async function createContact(data) {

    const address = data.shipping_address || {};

    try {
        const response = await axios.post(
            "https://www.zohoapis.in/crm/v2/Contacts",
            {
                data: [{
                    First_Name: address.first_name || "",
                    Last_Name: address.last_name || "Shopify",
                    Email: data.email,
                    Phone: address.phone || data.phone || "",

                    Shipping_Street: address.address1 || "",
                    Shipping_City: address.city || "",
                    Shipping_State: address.province || "",
                    Shipping_Code: address.zip || "",
                    Shipping_Country: address.country || ""
                }]
            },
            {
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`
                }
            }
        );

        console.log("👤 Contact Created");

        return response.data.data[0].details.id;

    } catch (error) {

        // 🔁 Token expired → refresh & retry
        if (error.response?.data?.code === "INVALID_TOKEN") {
            await refreshAccessToken();
            return createContact(data);
        }

        console.error("❌ Contact Error:", error.response?.data || error.message);
        return null;
    }
}

// 🟢 Create Deal
async function createDeal(data, contactId) {

    if (!contactId) {
        console.log("⚠️ No contactId found, skipping deal link");
    }

    const items = data.line_items || [];

    const productDetails = items.map(item => {
        return `Product: ${item.title}
Qty: ${item.quantity}
SKU: ${item.sku}
Variant: ${item.variant_title}`;
    }).join("\n\n");

    try {
        await axios.post(
            "https://www.zohoapis.in/crm/v2/Deals",
            {
                data: [{
                    Deal_Name: data.name,
                    Amount: data.total_price,
                    Stage: "Closed Won",
                    Closing_Date: new Date().toISOString().split("T")[0],

                    Contact_Name: contactId,

                    Description: `
🛒 PRODUCTS:
${productDetails}

💰 PRICING:
Subtotal: ${data.subtotal_price}
Shipping: ${data.total_shipping_price_set?.shop_money?.amount}
Discount: ${data.total_discounts}
Total: ${data.total_price}

📦 ORDER:
Payment: ${data.gateway || data.payment_gateway_names?.join(", ")}
Financial Status: ${data.financial_status}
Fulfillment: ${data.fulfillment_status || "Not Fulfilled"}

🧾 EXTRA:
Notes: ${data.note}
Tags: ${data.tags}
Order Date: ${data.created_at}
                    `
                }]
            },
            {
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`
                }
            }
        );

        console.log("💰 Deal Created");

    } catch (error) {

        // 🔁 Token expired → refresh & retry
        if (error.response?.data?.code === "INVALID_TOKEN") {
            await refreshAccessToken();
            return createDeal(data, contactId);
        }

        console.error("❌ Deal Error:", error.response?.data || error.message);
    }
}

// 🧪 Health Check
app.get("/", (req, res) => {
    res.send("🚀 Shopify → Zoho CRM Integration Running");
});

// 🚀 Server Start
app.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});

