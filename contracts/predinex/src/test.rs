#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env};

#[test]
fn test_create_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let title = String::from_str(&env, "Market 1");
    let description = String::from_str(&env, "Desc 1");
    let outcome_a = String::from_str(&env, "Yes");
    let outcome_b = String::from_str(&env, "No");
    let duration = 3600;

    let pool_id = client.create_pool(
        &creator,
        &title,
        &description,
        &outcome_a,
        &outcome_b,
        &duration,
    );
    assert_eq!(pool_id, 1);

    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.creator, creator);
    assert_eq!(pool.title, title);
}

#[test]
fn test_place_bet() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address());

    let creator = Address::generate(&env);
    let user = Address::generate(&env);

    token_admin_client.mint(&user, &1000);

    let title = String::from_str(&env, "Market 1");
    let description = String::from_str(&env, "Desc 1");
    let outcome_a = String::from_str(&env, "Yes");
    let outcome_b = String::from_str(&env, "No");
    let duration = 3600;

    let pool_id = client.create_pool(
        &creator,
        &title,
        &description,
        &outcome_a,
        &outcome_b,
        &duration,
    );

    client.place_bet(&user, &pool_id, &0, &100);

    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_a, 100);
    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
}

#[test]
fn test_settle_and_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address());

    let creator = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    token_admin_client.mint(&user1, &1000);
    token_admin_client.mint(&user2, &1000);

    let title = String::from_str(&env, "Market 1");
    let description = String::from_str(&env, "Desc 1");
    let outcome_a = String::from_str(&env, "Yes");
    let outcome_b = String::from_str(&env, "No");
    let duration = 3600;

    let pool_id = client.create_pool(
        &creator,
        &title,
        &description,
        &outcome_a,
        &outcome_b,
        &duration,
    );

    client.place_bet(&user1, &pool_id, &0, &100);
    client.place_bet(&user2, &pool_id, &1, &100);

    // Advance ledger timestamp past the pool expiry so settlement is allowed
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    // Settle with outcome 0 (A wins)
    client.settle_pool(&creator, &pool_id, &0);

    let pool = client.get_pool(&pool_id).unwrap();
    assert!(pool.settled);
    assert_eq!(pool.winning_outcome, Some(0));

    // User 1 claims
    let winnings = client.claim_winnings(&user1, &pool_id);

    // Total pool = 200. Fee (2%) = 4. Net = 196.
    // User1 bet 100 on winning outcome (0). Total winners = 100.
    // Share = 100 * 196 / 100 = 196.
    assert_eq!(winnings, 196);
    assert_eq!(token.balance(&user1), 900 + 196);
}

#[test]
#[should_panic(expected = "No bet found")]
fn test_duplicate_claim_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address());

    let creator = Address::generate(&env);
    let user = Address::generate(&env);

    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user, &pool_id, &0, &100);

    // Advance ledger timestamp past the pool expiry so settlement is allowed
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    client.settle_pool(&creator, &pool_id, &0);

    // First claim succeeds
    let winnings = client.claim_winnings(&user, &pool_id);
    assert_eq!(winnings, 98); // 100 * (100 - 2% fee) / 100
    let balance_after_first = token.balance(&user);
    assert_eq!(balance_after_first, 900 + 98);

    // Second claim must panic — bet entry was removed after first claim
    client.claim_winnings(&user, &pool_id);
}

// ============================================================================
// Issue #62: Initialization idempotency tests
//
// The contract's `initialize` function must only succeed once. Calling it a
// second time must panic with "Already initialized", and the originally
// configured token address must remain unchanged. This guards deployment
// safety by ensuring the token binding is immutable after first setup.
// ============================================================================

/// Verifies that the first `initialize` call succeeds and stores the token
/// address, and that a second `initialize` call panics without altering the
/// stored configuration.
#[test]
fn test_initialize_succeeds_once() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    // First initialization should succeed
    client.initialize(&token_id.address());

    // Verify the token address is stored by using it in a full flow:
    // create a pool and place a bet (which reads the stored token address)
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
    let creator = Address::generate(&env);
    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    // place_bet internally reads DataKey::Token — this proves initialize stored it
    client.place_bet(&user, &pool_id, &0, &100);
    let token = token::Client::new(&env, &token_id.address());
    assert_eq!(token.balance(&user), 900);
}

/// A second `initialize` call must be rejected with "Already initialized".
#[test]
#[should_panic(expected = "Already initialized")]
fn test_initialize_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    // First initialization succeeds
    client.initialize(&token_id.address());

    // Second initialization must panic
    let other_token_admin = Address::generate(&env);
    let other_token_id = env.register_stellar_asset_contract_v2(other_token_admin.clone());
    client.initialize(&other_token_id.address());
}

/// After the rejected second `initialize`, the original token address must
/// still be in effect. We verify this by placing a bet that internally reads
/// the stored token and confirming it uses the original one.
#[test]
fn test_initialize_idempotency_preserves_original_token() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    // First initialization with the original token
    client.initialize(&token_id.address());

    // Attempt second initialization with a different token (will panic internally)
    let other_token_admin = Address::generate(&env);
    let other_token_id = env.register_stellar_asset_contract_v2(other_token_admin.clone());
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initialize(&other_token_id.address());
    }));

    // The original token should still be active — verify by placing a bet
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
    let creator = Address::generate(&env);
    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    // This would fail if the token address had been overwritten
    client.place_bet(&user, &pool_id, &0, &100);
    let token = token::Client::new(&env, &token_id.address());
    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
}

// ============================================================================
// Issue #56: Pool settlement before expiry guard tests
//
// The contract must prevent creators from settling a pool before its expiry
// timestamp has passed. This ensures fairness by giving all participants the
// full betting window. Settlement after expiry should continue to work normally.
// ============================================================================

/// Attempting to settle a pool before its expiry timestamp must be rejected.
#[test]
#[should_panic(expected = "Pool has not expired yet")]
fn test_settle_pool_before_expiry_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address());

    let creator = Address::generate(&env);
    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user, &pool_id, &0, &100);

    // Ledger timestamp is still 0 (before expiry at 3600) — settlement must fail
    client.settle_pool(&creator, &pool_id, &0);
}

/// Settlement after expiry should succeed normally through the full lifecycle.
#[test]
fn test_settle_pool_after_expiry_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address());

    let creator = Address::generate(&env);
    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user, &pool_id, &0, &100);

    // Advance ledger timestamp past expiry
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    // Settlement should now succeed
    client.settle_pool(&creator, &pool_id, &0);

    let pool = client.get_pool(&pool_id).unwrap();
    assert!(pool.settled);
    assert_eq!(pool.winning_outcome, Some(0));

    // Verify claim still works after proper settlement
    let winnings = client.claim_winnings(&user, &pool_id);
    assert_eq!(winnings, 98); // 100 * (100 - 2%) / 100
    assert_eq!(token.balance(&user), 900 + 98);
}

// ============================================================================
// Issue #61: Unauthorized settlement rejection tests
//
// Only the pool creator is authorized to settle a pool. A non-creator caller
// must be rejected with "Unauthorized", and the pool must remain unsettled.
// The authorized creator should still be able to settle afterward.
// ============================================================================

/// A non-creator account attempting to settle a pool must be rejected.
#[test]
#[should_panic(expected = "Unauthorized")]
fn test_settle_pool_unauthorized_caller_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address());

    let creator = Address::generate(&env);
    let non_creator = Address::generate(&env);
    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user, &pool_id, &0, &100);

    // Advance past expiry
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    // Non-creator attempts settlement — must panic with "Unauthorized"
    client.settle_pool(&non_creator, &pool_id, &0);
}

/// After an unauthorized settlement attempt fails, the pool must remain
/// unsettled and the authorized creator can still settle it successfully.
#[test]
fn test_settle_pool_unauthorized_then_authorized_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address());

    let creator = Address::generate(&env);
    let non_creator = Address::generate(&env);
    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user, &pool_id, &0, &100);

    // Advance past expiry
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    // Non-creator attempt — catch the panic so we can continue
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.settle_pool(&non_creator, &pool_id, &0);
    }));

    // Pool must remain unsettled after the unauthorized attempt
    let pool = client.get_pool(&pool_id).unwrap();
    assert!(!pool.settled);
    assert_eq!(pool.winning_outcome, None);

    // Authorized creator can still settle successfully
    client.settle_pool(&creator, &pool_id, &0);

    let pool = client.get_pool(&pool_id).unwrap();
    assert!(pool.settled);
    assert_eq!(pool.winning_outcome, Some(0));
}
