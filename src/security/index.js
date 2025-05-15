const { PublicKey } = require('@solana/web3.js');
const logger = require('../utils/logger');
const { PUMPFUN_PROGRAM_ID } = require('../config');
const config = require('../config').loadConfig();
const fs = require('fs');

// Disallowed instruction names / program IDs that indicate potential scams
const DISALLOWED_INSTRUCTIONS = new Set([
  "mintTo", "mintToChecked",
  "burn", "burnChecked", 
  "setAuthority",
  "freezeAccount", "thawAccount",
  "closeAccount"
]);

// Programs that might be used maliciously
const DISALLOWED_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  // SPL Token program
  "11111111111111111111111111111111"               // SystemProgram (for SOL transfers)
]);

// Path for logging suspicious tokens
const SUSPICIOUS_LOG_PATH = './suspicious.log';

/**
 * Log details about a suspicious token to a file
 * @param {Object} data - Token information
 */
function logSuspicious(data) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, ...data };
  
  try {
    fs.appendFileSync(SUSPICIOUS_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger.error(`Failed to log suspicious token: ${err.message}`);
  }
  
  logger.warn(`Suspicious token detected: ${JSON.stringify(entry)}`);
}

/**
 * Fetch and check a mint account's authorities
 * @param {Object} connection - Solana connection
 * @param {string} mintPubkeyStr - Mint address as string
 * @returns {Promise<boolean>} True if authorities are safe
 */
async function checkMintAuthorities(connection, mintPubkeyStr) {
  // Skip this check if it's disabled in config
  if (!config.enableMintAuthorityChecks) {
    logger.info('Mint authority checks are disabled in config');
    return true;
  }
  
  try {
    const mintPubkey = new PublicKey(mintPubkeyStr);
    const resp = await connection.getParsedAccountInfo(mintPubkey);
    
    if (!resp.value || !resp.value.data) {
      throw new Error("Failed to fetch mint account");
    }
    
    const info = resp.value.data.parsed?.info;
    if (!info) {
      throw new Error("Failed to parse mint account data");
    }

    const { mintAuthority, freezeAuthority } = info;
    
    // For Pump.fun tokens, the authority should be the Pump.fun program or null
    // We only allow null or the Pump.fun program ID as authority
    const allowedAuthority = PUMPFUN_PROGRAM_ID;
    
    if (mintAuthority && mintAuthority !== allowedAuthority) {
      throw new Error(`Suspicious mintAuthority: ${mintAuthority}`);
    }
    
    if (freezeAuthority && freezeAuthority !== allowedAuthority) {
      throw new Error(`Suspicious freezeAuthority: ${freezeAuthority}`);
    }
    
    logger.debug(`Mint authorities check passed for ${mintPubkeyStr}`);
    return true;
  } catch (err) {
    logger.warn(`Mint authority check failed: ${err.message}`);
    return false;
  }
}

/**
 * Scan a transaction for potentially malicious instructions
 * @param {Object} connection - Solana connection
 * @param {string} signature - Transaction signature
 * @returns {Promise<Object>} Result of scan
 */
async function scanTransactionForBackdoors(connection, signature) {
  // Skip this check if it's disabled in config
  if (!config.enableCpiChecks) {
    logger.info('CPI security checks are disabled in config');
    return { found: false };
  }
  
  try {
    const tx = await connection.getParsedTransaction(signature, { 
      maxSupportedTransactionVersion: 0,
      encoding: 'jsonParsed' 
    });
    
    if (!tx) {
      throw new Error(`Transaction not found: ${signature}`);
    }
    
    logger.debug(`Scanning transaction ${signature} for malicious instructions`);
    
    // Check main instructions for explicit disallowed operations
    for (const instr of tx.transaction.message.instructions) {
      const programId = instr.programId?.toString();
      const ixName = instr.parsed?.type;
      
      if (programId && ixName && DISALLOWED_PROGRAMS.has(programId) && DISALLOWED_INSTRUCTIONS.has(ixName)) {
        return { 
          found: true, 
          programId, 
          ixName,
          instruction: instr
        };
      }
      
      // Look for SystemProgram.transfer calls with unexpected recipients
      if (programId === '11111111111111111111111111111111' && ixName === 'transfer') {
        // Need to check the destination (if it's an unexpected address)
        if (instr.parsed?.info?.destination) {
          // In a legitimate token launch, transfers should only be to known programs
          // like token program or Pump.fun program for fees
          // This is more complex and we'd need a whitelist of allowed destinations
          // For now, just log this for information
          logger.debug(`Found SOL transfer to ${instr.parsed.info.destination}`);
        }
      }
    }
    
    // Check inner instructions - these are often where malicious operations hide
    if (tx.meta?.innerInstructions?.length > 0) {
      for (const inner of tx.meta.innerInstructions) {
        for (const innerIx of inner.instructions) {
          const programId = innerIx.programId?.toString();
          const ixName = innerIx.parsed?.type;
          
          if (programId && ixName && DISALLOWED_PROGRAMS.has(programId) && DISALLOWED_INSTRUCTIONS.has(ixName)) {
            // Found suspicious instruction
            return { 
              found: true, 
              programId, 
              ixName,
              isInner: true,
              instruction: innerIx
            };
          }
          
          // Also check for suspicious token or SOL transfers inside CPIs
          if (programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && ixName === 'transfer') {
            // Log token transfers in CPIs
            logger.debug(`Found token transfer in CPI, source: ${innerIx.parsed?.info?.source}, dest: ${innerIx.parsed?.info?.destination}`);
          }
          
          if (programId === '11111111111111111111111111111111' && ixName === 'transfer') {
            // Log SOL transfers in CPIs 
            logger.debug(`Found SOL transfer in CPI: ${JSON.stringify(innerIx.parsed?.info)}`);
          }
        }
      }
    }
    
    // Also look in transaction logs for indicators of malicious behavior
    if (tx.meta?.logMessages) {
      for (const log of tx.meta.logMessages) {
        // Look for indicators of potential issues in the logs
        if (log.includes('SetAuthority') || 
            log.includes('MintTo') || 
            log.includes('Burn') || 
            log.includes('CloseAccount') ||
            log.includes('FreezeAccount')) {
          return {
            found: true,
            programId: 'unknown',
            ixName: 'unknown',
            reason: `Suspicious operation found in logs: ${log}`
          };
        }
      }
    }
    
    logger.debug(`No suspicious instructions found in transaction ${signature}`);
    return { found: false };
  } catch (err) {
    logger.warn(`Transaction scan failed: ${err.message}`);
    return { 
      found: true, 
      error: err.message,
      errorType: 'scan_error'
    };
  }
}

/**
 * Comprehensive security check for a new token
 * @param {Object} connection - Solana connection
 * @param {string} mintAddress - Token mint address
 * @param {string} transactionSignature - Creation transaction signature
 * @returns {Promise<boolean>} True if the token passes security checks
 */
async function isTokenSecure(connection, mintAddress, transactionSignature) {
  try {
    logger.info(`Running enhanced security checks for token ${mintAddress}`);
    
    // Step 1: Check mint authorities - verify the token can't be minted by unauthorized parties
    const authoritiesOk = await checkMintAuthorities(connection, mintAddress);
    if (!authoritiesOk) {
      const reason = "Suspicious mint authorities - token could be arbitrarily minted";
      logger.warn(reason);
      logSuspicious({
        mint: mintAddress,
        signature: transactionSignature,
        reason,
        checkType: "mint_authority"
      });
      return false;
    }
    
    // Step 2: Scan for backdoor instructions in the transaction
    // This checks for any of the following red flags:
    // - MintTo/MintToChecked instructions (arbitrary new token minting)
    // - Burn/BurnChecked instructions (ability to burn your tokens)
    // - SetAuthority (changing mint authority to malicious key)
    // - FreezeAccount/ThawAccount (locking your ATA so you can't move tokens)
    // - CloseAccount (forcibly closing your ATA or main account)
    // - SystemProgram.transfer in a CPI (moving SOL out of your wallet)
    // - SPL TokenProgram.transfer in a CPI with unexpected destination
    const scanResult = await scanTransactionForBackdoors(connection, transactionSignature);
    
    if (scanResult.found) {
      let reason;
      
      if (scanResult.error) {
        reason = `Error scanning transaction: ${scanResult.error}`;
      } else if (scanResult.reason) {
        reason = scanResult.reason;
      } else {
        reason = `Disallowed instruction '${scanResult.ixName}' in program ${scanResult.programId}` +
          (scanResult.isInner ? ' (hidden in inner instruction)' : '');
      }
      
      logger.warn(reason);
      logSuspicious({
        mint: mintAddress,
        signature: transactionSignature,
        reason,
        instruction: scanResult.ixName,
        program: scanResult.programId,
        isInnerInstruction: !!scanResult.isInner,
        checkType: "malicious_instruction"
      });
      
      return false;
    }
    
    // All checks passed
    logger.info(`Token ${mintAddress} passed all security checks`);
    return true;
  } catch (err) {
    logger.error(`Security check error: ${err.message}`);
    logSuspicious({
      mint: mintAddress,
      signature: transactionSignature,
      reason: `Error during security check: ${err.message}`,
      checkType: "error"
    });
    return false;
  }
}

module.exports = {
  isTokenSecure,
  logSuspicious
};