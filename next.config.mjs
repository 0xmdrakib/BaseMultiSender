/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // MetaMask SDK's browser bundle contains a guarded React Native-only require.
    // Mark it unavailable on web so Webpack does not try to resolve RN storage.
    config.resolve.alias["@react-native-async-storage/async-storage"] = false;
    return config;
  },
};

export default nextConfig;
