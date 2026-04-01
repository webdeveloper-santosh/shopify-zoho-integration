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
        if (
    error.response?.data?.code === "INVALID_TOKEN" ||
    error.response?.status === 401
) {
    console.log("🔄 Refreshing token...");
    await refreshAccessToken();
    return createDeal(data, contactId);
}
        throw error;
    }
}

// 💰 Create Deal (FINAL VERSION)
async function createDeal(data, contactId) {

    // ✅ Safety check (MOST IMPORTANT)
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
                    Deal_Name: data.name,
                    Amount: data.total_price,
                    Stage: "Closed Won",
                    Closing_Date: new Date().toISOString().split("T")[0],

                    // ✅ IMPORTANT (duplicate रोकने के लिए)
                    Order_Id: data.id,

                    Contact_Name: {
                    id: contactId
                                    },
                    SKU: items.map(i => i.sku).join(", "),
    Payment_Method: data.gateway || data.payment_gateway_names?.join(", "),


                    Description: `
🛒 PRODUCTS:
${productDetails}

👤 CUSTOMER:
Name: ${data.customer?.first_name} ${data.customer?.last_name}
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

        // 🔄 Token expire handle
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

        // 💰 DEAL HANDLE
        if (
            data.total_price !== undefined &&
            data.total_price !== null &&
            contactId
        ) {
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
