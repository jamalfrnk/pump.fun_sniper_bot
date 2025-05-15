const logger = require('../utils/logger');
const { SUSPICIOUS_TOKEN_NAMES } = require('../config');

/**
 * Check if a token is likely to be safe (not a scam/rug)
 * @param {Object} tokenInfo - Token information
 * @returns {boolean} - True if the token passes safety checks
 */
async function isTokenSafe(tokenInfo) {
  // This is a simplified implementation of token safety checks
  // In a full implementation, you would include:
  // 1. Creator address reputation check
  // 2. Contract code analysis
  // 3. Liquidity checks
  // 4. Token distribution analysis
  // 5. Trading pattern analysis
  
  logger.info(`Analyzing token ${tokenInfo.name} (${tokenInfo.mintAddress})`);
  
  // 1. Basic name checks
  const nameLowercase = tokenInfo.name.toLowerCase();
  const symbolLowercase = tokenInfo.symbol.toLowerCase();
  
  // Calculate a risk score based on suspicious keywords
  let riskScore = 0;
  const highRiskKeywords = ['scam', 'rug', 'fake', 'honeypot', 'ponzi'];
  const mediumRiskKeywords = ['moon', 'safe', 'gem', '100x', 'guaranteed'];
  
  // Check for high risk keywords (immediate rejection)
  for (const keyword of highRiskKeywords) {
    if (nameLowercase.includes(keyword) || symbolLowercase.includes(keyword)) {
      logger.warn(`Token name/symbol contains high-risk keyword: ${keyword}`);
      return false;
    }
  }
  
  // Check for suspicious keywords (adds to risk score)
  for (const keyword of SUSPICIOUS_TOKEN_NAMES) {
    if (nameLowercase.includes(keyword) || symbolLowercase.includes(keyword)) {
      if (mediumRiskKeywords.includes(keyword)) {
        riskScore += 2; // Medium risk keywords have higher weight
      } else {
        riskScore += 1; // Low risk keywords have lower weight
      }
      logger.debug(`Token contains suspicious keyword: ${keyword} (risk score: ${riskScore})`);
    }
  }
  
  // Reject tokens with too many suspicious keywords
  if (riskScore >= 3) {
    logger.warn(`Token rejected due to high risk score: ${riskScore}`);
    return false;
  }
  
  // 2. Symbol length check
  // Most legitimate tokens have short symbols (2-6 characters)
  if (symbolLowercase.length > 10) {
    logger.warn(`Token symbol is unusually long: ${tokenInfo.symbol}`);
    return false;
  }
  
  // 3. Check token name vs symbol consistency
  // Often scam tokens have mismatching names/symbols
  const firstLettersMatch = nameLowercase.charAt(0) === symbolLowercase.charAt(0);
  if (!firstLettersMatch && symbolLowercase.length >= 3) {
    logger.debug(`Token name and symbol first letters don't match - potential yellow flag`);
    // Not failing just for this, but it's a yellow flag
  }
  
  // 4. Creator address check
  // In a full implementation, you would maintain a blacklist of known scammer addresses
  // and check if the token creator is on that list
  
  // 5. Time-based check
  // New tokens might be more risky because they haven't been "battle-tested"
  // But since we're specifically looking for new tokens, this doesn't apply
  
  // 6. Realistic token distribution
  // In a full implementation, you'd check if the token has a realistic distribution or
  // if most of the supply is held by the creator (suggesting a potential rug pull)
  
  // For now, let's assume the token passes our basic checks
  logger.info(`Token ${tokenInfo.name} (${tokenInfo.mintAddress}) passed basic safety checks`);
  
  return true;
}

module.exports = {
  isTokenSafe
};