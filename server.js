require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;


//new code added 
async function findDealByOrderId(orderId) {
    try {
        const res = await axios.get(
            `https://www.zohoapis.in/crm/v2/Deals/search?criteria=(Order_ID:equals:${orderId})`,
            {
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`
                }
            }
        );

        return res.data.data?.[0] || null;

    } catch (error) {
        return null;
    }
}


let accessToken = "";

// 🔄 Refresh Access Token
async function refreshAccessToken() {
    try {
        // ⏳ Delay add kiya (IMPORTANT)
        await new Promise(resolve => setTimeout(resolve, 2000));

        const response = await axios.post("https://accounts.zoho.in/oauth/v2/token", null, {
            params: {
                refresh_token: REFRESH_TOKEN,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: "refresh_token"
            }
        });

        accessToken = response.data.access_token;
        console.log("🔄 New Access Token Generated");

    } catch (error) {
        console.error("❌ Token Refresh Error:", error.response?.data || error.message);
    }
}

// Contact By email ID 
async function findContactByEmail(email) {
    try {
        const res = await axios.get(
            `https://www.zohoapis.in/crm/v2/Contacts/search?criteria=(Email:equals:${email})`,
            {
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`
                }
            }
        );

        return res.data.data?.[0] || null;

    } catch (error) {
        return null;
    }
}

// 👤 Create Contact
// 👤 Create Contact (FINAL PRO VERSION)
async function createContact(data) {

    try {

        const response = await axios.post(
            "https://www.zohoapis.in/crm/v2/Contacts",
            {
                data: [{
                    Last_Name: data.customer?.last_name || "Shopify",
                    First_Name: data.customer?.first_name || "",

                    Email: data.email,
                    Phone: data.phone,

                    Mailing_Street: data.shipping_address?.address1,
                    Mailing_City: data.shipping_address?.city,
                    Mailing_State: data.shipping_address?.province,
                    Mailing_Zip: data.shipping_address?.zip,
                    Mailing_Country: data.shipping_address?.country,

                    Description: `
Order ID: ${data.id}
Customer Note: ${data.note}
Tags: ${data.tags}
                    `
                }]
            },
            {
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`
                }
            }
        );

        console.log("👤 Contact Created");

        // 🔥 MOST IMPORTANT LINE (ID RETURN)
        return response.data.data[0].details.id;

    } catch (error) {

        // 🔄 Token expire handle
        if (error.response?.data?.code === "INVALID_TOKEN") {
            console.log("🔄 Token expired, refreshing...");

            await refreshAccessToken();

            // ✅ RETRY
            return createContact(data);
        }

        console.error("❌ Contact Error:", error.response?.data || error.message);
        return null;
    }
}

// 💰 Create Deal (FINAL PRO VERSION)
async function createDeal(data, contactId) {

    // ✅ Safety check
    if (!contactId) {
        console.log("❌ No contactId, skipping deal");
        return;
    }

    const items = data.line_items || [];

    const productDetails = items.map(item => {
        return `Product: ${item.title}
Qty: ${item.quantity}
SKU: ${item.sku}
Variant: ${item.variant_title}`;
    }).join("\n\n");

    try {

        const response = await axios.post(
            "https://www.zohoapis.in/crm/v2/Deals",
            {
                data: [{
                    // 🧾 BASIC INFO
                    Deal_Name: data.name,
                    Amount: data.total_price,
                    Stage: "Closed Won",
                    Closing_Date: new Date().toISOString().split("T")[0],

                    // 🔗 CONTACT LINK (FIXED)
                    Contact_Name: {
                        id: contactId
                    },

                    // 🆔 ORDER ID (duplicate control)
                    Order_Id: data.id,

                    // 🔥 CUSTOM FIELDS
                    SKU: items.map(i => i.sku).join(", "),
                    Payment_Method: data.gateway || data.payment_gateway_names?.join(", "),

                    // 📝 DESCRIPTION (FULL DETAILS)
                    Description: `
🛒 PRODUCTS:
${productDetails}

👤 CUSTOMER:
Name: ${data.customer?.first_name || "Guest"} ${data.customer?.last_name || ""}
Email: ${data.email}
Phone: ${data.phone}

📍 ADDRESS:
${data.shipping_address?.address1}
${data.shipping_address?.city}, ${data.shipping_address?.province}
${data.shipping_address?.zip}, ${data.shipping_address?.country}

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

        return response.data;

    } catch (error) {

        // 🔄 Token expired handle
        if (error.response?.data?.code === "INVALID_TOKEN") {
            console.log("🔄 Token expired, refreshing...");

            await refreshAccessToken();

            // ✅ SAFE RETRY
            if (contactId) {
                return createDeal(data, contactId);
            } else {
                console.log("❌ Retry skipped, no contactId");
            }
        }

        console.error("❌ Deal Error:", error.response?.data || error.message);
    }
}


// 🟢 Webhook
app.post("/webhook/shopify", async (req, res) => {
    const data = req.body;
    console.log("📦 Order:", data.id);

    try {

        let contactId = null;

        // 👤 CONTACT HANDLE
        if (data.email) {

            let existingContact = await findContactByEmail(data.email);

            if (existingContact) {
                console.log("👤 Contact already exists");
                contactId = existingContact.id;
            } else {
                contactId = await createContact(data);
            }
        }

        console.log("👉 Final Contact ID:", contactId); // DEBUG

        // 💰 DEAL HANDLE
        if (data.total_price && contactId) {

            let existingDeal = await findDealByOrderId(data.id);

            if (existingDeal) {
                console.log("💰 Deal already exists");
            } else {
                await createDeal(data, contactId);
            }

        } else {
            console.log("❌ Skipping deal, no contactId or price");
        }

        res.sendStatus(200);

    } catch (error) {
        console.error("❌ Error:", error.message);
        res.sendStatus(500);
    }
});

// 🧪 Test route
app.get("/", (req, res) => {
    res.send("🚀 Shopify → Zoho Running");
});

app.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
