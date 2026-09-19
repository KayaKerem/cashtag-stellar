//! Test vectors. See docs/reclaim-notes.md and fixtures/reclaim/.

/// Real vector from Reclaim's own Soroban verifier (reclaimprotocol/stellar-sdk-onchain-integration,
/// contracts/reclaim/src/test.rs): EIP-191 digest, r‖s, recovery id, expected witness address.
pub const REAL_DIGEST: &str = "c32e57b71247c1aab4b93bb0a2bb373186acc2d5c9bd8dfcd046e1d0553fd421";
pub const REAL_SIGNATURE: &str = "2888485f650f8ed02d18e32dd9a1512ca05feb83fc2cbf2df72fd8aa4246c5ee541fa53875c70eb64d3de9143446229a250c7a762202b7cc289ed31b74b31c81";
pub const REAL_RECOVERY_ID: u32 = 1;
pub const REAL_WITNESS: &str = "244897572368eadf65bfbc5aec98d8e5443a9072";

/// Reference vector produced by fixtures/reclaim/gen-reference-vector.mjs, which runs the exact
/// attestor-core code (`canonicalize`, `getIdentifierFromClaimInfo`, `createSignDataForClaim`,
/// ethers EIP-191 signing) on a zkFetch-shaped YouTube claim. Same data as
/// fixtures/reclaim/reference-vector.json.
pub const REF_ATTESTOR_SECRET: &str = "f1493165bfdf5677d8deec270ad51cb2e74b4a892373618bb4d0e817a85e02c9";
pub const REF_ATTESTOR_ADDRESS: &str = "a02aec92a8bdcbd9a910b43dfd755340f1289143";
pub const REF_OWNER: &str = "0x732456af65a53384cf71a174865dd31414df4c6b";
pub const REF_TIMESTAMP_S: u64 = 1758240000;
pub const REF_EPOCH: u32 = 1;
pub const REF_URL: &str = "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=dQw4w9WgXcQ";
pub const REF_PARAMETERS: &str = r#"{"body":"","method":"GET","responseMatches":[{"type":"regex","value":"\"viewCount\":\\s*\"(?<views>\\d+)\""},{"type":"regex","value":"\"description\":\\s*\"(?<desc>(?:[^\"\\\\]|\\\\.)*)\""}],"responseRedactions":[],"url":"https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=dQw4w9WgXcQ"}"#;
pub const REF_CONTEXT: &str = r#"{"contextAddress":"0x0","contextMessage":"cliprail:c1:e1","extractedParameters":{"desc":"Official video. Join the campaign: CR-7F3K9Q\\nLinks: https://example.com/?a=1&b=2 \\\"quoted\\\" \\\\ backslash é 🎉 fake \\\"viewCount\\\":\\\"999\\\" and \\\"views\\\":\\\"888\\\"","views":"1234567"},"providerHash":"0xa058c1b0997d173fbd84aa29d828967239b4c699eba7f71faa16ad88d98c2321"}"#;
pub const REF_IDENTIFIER: &str = "d4d6690744dd24356a9aa0982a0490b8b51bff20b5a98d4d504e5711ad4f8f28";
pub const REF_DIGEST: &str = "39d74646c55908d40fb241ac6bdc3cd0566d527923f0a5a0408de4abcb30b9df";
/// r ‖ s ‖ v (v = 0x1b = 27 → recovery id 0)
pub const REF_SIGNATURE_RSV: &str = "ab65d5438bd51c8d71e523cb6b77054a24c4704a3c4bda77453b6a45c39619903cd0b212348263fe46d7fbdd0919893697f469b80d8b01a43d4c8a562eaa5de81b";

/// The two `responseMatches` entries exactly as they appear inside canonical `parameters`
/// (what `cliprail` passes as `required`).
pub const REQ_VIEWS: &str = r#"{"type":"regex","value":"\"viewCount\":\\s*\"(?<views>\\d+)\""}"#;
pub const REQ_DESC: &str = r#"{"type":"regex","value":"\"description\":\\s*\"(?<desc>(?:[^\"\\\\]|\\\\.)*)\""}"#;
pub const CODE: &str = "CR-7F3K9Q";
