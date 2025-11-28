import fetch from "node-fetch";

export async function publishLinkedIn({ personUrn, accessToken, text, image_url }) {
  try {
    let mediaURN = null;

    // 1️⃣ If image provided, upload to LinkedIn
    if (image_url) {
      console.log("🔵 Uploading image to LinkedIn...");

      // Step 1 — Register upload
      const registerRes = await fetch(
        "https://api.linkedin.com/v2/assets?action=registerUpload",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0"
          },
          body: JSON.stringify({
            registerUploadRequest: {
              recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
              owner: personUrn,
              serviceRelationships: [
                {
                  relationshipType: "OWNER",
                  identifier: "urn:li:userGeneratedContent"
                }
              ]
            }
          })
        }
      );

      const registerData = await registerRes.json();
      console.log("Register Upload:", registerData);

      if (!registerData.value) {
        return { success: false, error: "Failed to register upload" };
      }

      const uploadUrl =
        registerData.value.uploadMechanism[
          "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
        ].uploadUrl;

      mediaURN = registerData.value.asset; // LinkedIn URN

      // Step 2 — Download image
      const imgRes = await fetch(image_url);
      const imgBuffer = await imgRes.arrayBuffer();

      // Step 3 — Upload binary image to LinkedIn
      await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream"
        },
        body: Buffer.from(imgBuffer)
      });

      console.log("✅ Image uploaded. Media URN:", mediaURN);
    }

    // 2️⃣ Create the actual Post
    const postBody = {
      author: personUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: image_url ? "IMAGE" : "NONE",
          media: image_url
            ? [
                {
                  status: "READY",
                  media: mediaURN,
                  title: { text: "Post" }
                }
              ]
            : []
        }
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
      }
    };

    const postRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0"
      },
      body: JSON.stringify(postBody)
    });

    const postData = await postRes.json();

    if (!postRes.ok) {
      console.log("❌ LinkedIn error:", postData);
      return { success: false, error: postData };
    }

    console.log("🎉 LinkedIn Post Created:", postData);

    return { success: true, postId: postData.id };
  } catch (err) {
    console.error("❌ LinkedIn publish error:", err);
    return { success: false, error: err.message };
  }
}
