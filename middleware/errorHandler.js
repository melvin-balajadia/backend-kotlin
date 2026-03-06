import logger from "../config/logger.js";

const errorHandler = (err, req, res, next) => {
  logger.error(err.stack);

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
};

export default errorHandler;
