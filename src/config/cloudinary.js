const cloudinary = require('cloudinary').v2;
const logger = require('./logger');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Upload a buffer or file path to Cloudinary
 * @param {Buffer|string} source - Buffer or file path
 * @param {object} options - Cloudinary upload options
 */
async function uploadToCloudinary(source, options = {}) {
  const defaults = {
    folder: 'qr-estate',
    resource_type: 'auto',
    quality: 'auto',
    fetch_format: 'auto',
  };

  const uploadOptions = { ...defaults, ...options };

  try {
    if (Buffer.isBuffer(source)) {
      return await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
        uploadStream.end(source);
      });
    }
    return await cloudinary.uploader.upload(source, uploadOptions);
  } catch (err) {
    logger.error('Cloudinary upload error:', err);
    throw err;
  }
}

/**
 * Delete a file from Cloudinary by public_id
 */
async function deleteFromCloudinary(publicId) {
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    logger.error('Cloudinary delete error:', err);
    throw err;
  }
}

module.exports = { cloudinary, uploadToCloudinary, deleteFromCloudinary };
